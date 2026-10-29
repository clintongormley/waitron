import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  assignProductUnit,
  createExtraList,
  createProduct,
  createUnit,
  readContentLanguages,
  writeProductModifiers,
} from "@waitron/catalogue";
import {
  orderPortions,
  withTransaction,
  workingLinePortions,
  workingOrderLines,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deletePortionBindings,
  expandPortionRows,
  portionIdentities,
  readPortionBindings,
  registerPortions,
  type PortionRef,
} from "./order-portions.js";
import { createTable } from "./testing/live-table.js";
import { openPartyTab } from "./testing/serve-line.js";
import { setupVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import {
  insertTabRound,
  priceOrderLines,
  priceTabRound,
  readStoredOrder,
  type OrderLineIdentity,
  type PricedTabRound,
} from "./working-order.js";

type Row = PricedTabRound["rows"][number];

const ORDER = "aaaaaaaa-0000-4000-8000-000000000001";

function dish(id: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    workingOrderId: ORDER,
    lineNo: 1,
    parentLineId: null,
    productId: `product-${id}`,
    name: "Oyster",
    descriptions: { en: "Oyster" },
    optionSnapshots: [],
    unitName: null,
    unitPrecision: 0,
    quantity: 1000,
    unitPriceGross: 150,
    vatClass: "reduced",
    lineTotal: 150,
    category: null,
    courseId: "course-1",
    note: "no lemon",
    makeAtStationId: "station-1",
    extraListId: null,
    variantName: "Large",
    variantDescriptions: { en: "Large" },
    variantKitchenName: "LG",
    kitchenName: "OYS",
    classification: null,
    ...overrides,
  };
}

function extra(id: string, parentLineId: string, overrides: Partial<Row> = {}): Row {
  return {
    ...dish(id),
    parentLineId,
    name: "Cheese",
    descriptions: { en: "Cheese" },
    variantName: null,
    variantDescriptions: null,
    variantKitchenName: null,
    kitchenName: "QUESO",
    courseId: null,
    note: null,
    makeAtStationId: null,
    extraListId: "list-1",
    unitPriceGross: 100,
    ...overrides,
  };
}

function context(row: Row, soldInEach?: true) {
  return {
    workingOrderLineId: row.id!,
    menuItemId: `offer-${row.productId}`,
    ...(soldInEach === undefined
      ? {}
      : {
          unit: {
            id: "unit-each",
            name: { en: "each" },
            precision: 0,
            hardwareUnit: null,
            soldInEach,
          },
        }),
  };
}

describe("A803 portions: splitting a priced round", () => {
  it("A803 portions: 12 oysters sold by the unit become 12 dishes with distinct ids, ordinals 1–12 and one cohort", () => {
    const oysters = dish("oysters", { quantity: 12000, lineTotal: 1800 });
    const out = expandPortionRows([oysters], [context(oysters)], [true], 7);

    expect(out.rows).toHaveLength(12);
    expect(new Set(out.rows.map((row) => row.id)).size).toBe(12);
    expect(out.rows[0]!.id).toBe("oysters");
    expect(out.rows.map((row) => row.lineNo)).toEqual([
      7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
    ]);
    expect(out.rows.every((row) => row.quantity === 1000 && row.lineTotal === 150)).toBe(true);
    expect(out.portions.map((portion) => portion.ordinal)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(out.portions.map((portion) => portion.lineId)).toEqual(out.rows.map((row) => row.id));
    expect(new Set(out.portions.map((portion) => portion.pricingCohortId)).size).toBe(1);
    expect(new Set(out.portions.map((portion) => portion.portionId)).size).toBe(12);
    expect(out.portions.every((portion) => !portion.measured)).toBe(true);
    expect(out.requestOfRow).toEqual(Array(12).fill(0));
  });

  it("A803 portions: a dozen product ordered once is one portion", () => {
    const dozen = dish("dozen", { quantity: 1000, unitName: { en: "dozen" }, lineTotal: 1800 });
    const out = expandPortionRows([dozen], [context(dozen)], [true], 1);

    expect(out.rows).toEqual([dozen]);
    expect(out.portions).toEqual([
      {
        portionId: expect.any(String),
        lineId: "dozen",
        ordinal: 1,
        pricingCohortId: expect.any(String),
        measured: false,
      },
    ]);
  });

  it("A803 portions: a line that is not whole portions is one measured portion, never split", () => {
    const wine = dish("wine", { quantity: 200000, unitName: { en: "ml" }, lineTotal: 600 });
    const ham = dish("ham", {
      quantity: 200,
      unitName: { en: "kg" },
      unitPrecision: 3,
      lineTotal: 480,
    });
    const out = expandPortionRows([wine, ham], [context(wine), context(ham)], [false, false], 3);

    expect(out.rows).toEqual([
      { ...wine, lineNo: 3 },
      { ...ham, lineNo: 4 },
    ]);
    expect(
      out.portions.map((portion) => [portion.lineId, portion.ordinal, portion.measured]),
    ).toEqual([
      ["wine", 1, true],
      ["ham", 1, true],
    ]);
    expect(out.portions[0]!.pricingCohortId).not.toBe(out.portions[1]!.pricingCohortId);
  });

  it("A803 portions: two burgers with cheese × 2 each carry their own cheese of 2, pointing at their own dish", () => {
    const burgers = dish("burgers", { name: "Burger", quantity: 2000, lineTotal: 1000 });
    const cheese = extra("cheese", "burgers", { quantity: 4000, lineTotal: 400 });
    const water = dish("water", { name: "Water", quantity: 1000, lineTotal: 200 });
    const out = expandPortionRows(
      [burgers, cheese, water],
      [context(burgers), context(cheese), context(water)],
      [true, false, true],
      1,
    );

    expect(
      out.rows.map((row) => [row.lineNo, row.name, row.quantity, row.lineTotal, row.parentLineId]),
    ).toEqual([
      [1, "Burger", 1000, 500, null],
      [2, "Cheese", 2000, 200, "burgers"],
      [3, "Burger", 1000, 500, null],
      [4, "Cheese", 2000, 200, out.rows[2]!.id],
      [5, "Water", 1000, 200, null],
    ]);
    expect(out.rows[1]!.id).toBe("cheese");
    expect(out.rows[3]!.id).not.toBe("cheese");
    expect(out.portions.map((portion) => portion.lineId)).toEqual([
      "burgers",
      out.rows[2]!.id,
      "water",
    ]);
    expect(out.requestOfRow).toEqual([0, 0, 0, 0, 1]);
    expect(out.lineContexts).toEqual([
      context(burgers),
      context(cheese),
      { ...context(burgers), workingOrderLineId: out.rows[2]!.id },
      { ...context(cheese), workingOrderLineId: out.rows[3]!.id },
      context(water),
    ]);
  });

  it("A803 portions: names, variant, options, note, course and station are copied to every portion, and each gets its own context with soldInEach kept", () => {
    const options = [
      { listId: "sizes", optionId: "big", name: "Big" },
    ] as unknown as Row["optionSnapshots"];
    const plates = dish("plates", { quantity: 3000, lineTotal: 450, optionSnapshots: options });
    const out = expandPortionRows([plates], [context(plates, true)], [true], 1);

    const copied = (row: Row) => ({
      ...row,
      id: null,
      lineNo: null,
      quantity: null,
      lineTotal: null,
    });
    expect(out.rows).toHaveLength(3);
    for (const row of out.rows) {
      expect(copied(row)).toEqual(copied(plates));
      expect([row.quantity, row.lineTotal]).toEqual([1000, 150]);
    }
    expect(out.lineContexts).toEqual(
      out.rows.map((row) => ({ ...context(plates, true), workingOrderLineId: row.id })),
    );
  });

  it("A803 portions: a whole-portion dish of a part quantity is refused as a bug", () => {
    const half = dish("half", { quantity: 2500, lineTotal: 1250 });
    expect(() => expandPortionRows([half], [context(half)], [true], 1)).toThrow(
      "expandPortionRows: line half's quantity 2500 is not a whole number of portions",
    );
  });

  it("A803 portions: a share that is not a whole number of cents is refused as a bug", () => {
    const odd = dish("odd", { quantity: 3000, lineTotal: 100 });
    expect(() => expandPortionRows([odd], [context(odd)], [true], 1)).toThrow(
      "expandPortionRows: line odd's total 100 does not split into 3 equal portions",
    );
  });
});

describe("A1208 portionIdentities: the portions each priced row stands for", () => {
  const identity = (row: Row): OrderLineIdentity => ({
    id: row.id!,
    productId: row.productId ?? null,
    classification: null,
    listUnitGross: null,
  });

  it("A1208 portionIdentities: a dish of two with two extras lists both portions under every row; a dish of one lists itself", () => {
    const burgers = dish("burgers", { name: "Burger", quantity: 2000, lineTotal: 1000 });
    const cheese = extra("cheese", "burgers", { quantity: 2000, lineTotal: 200 });
    const bacon = extra("bacon", "burgers", { name: "Bacon", quantity: 2000, lineTotal: 300 });
    const fries = dish("fries", { name: "Fries", quantity: 1000, lineTotal: 300 });
    const rows = [burgers, cheese, bacon, fries];
    const out = expandPortionRows(
      rows,
      rows.map((row) => context(row)),
      [true, false, false, true],
      1,
    );

    const identities = portionIdentities(rows.map(identity), rows, out);

    const [first, second, third] = out.portions;
    const burgerPortions = [first!.portionId, second!.portionId];
    expect(identities).toEqual([
      { ...identity(burgers), lineIds: ["burgers", out.rows[3]!.id], portionIds: burgerPortions },
      { ...identity(cheese), lineIds: ["cheese", out.rows[4]!.id], portionIds: burgerPortions },
      { ...identity(bacon), lineIds: ["bacon", out.rows[5]!.id], portionIds: burgerPortions },
      { ...identity(fries), lineIds: ["fries"], portionIds: [third!.portionId] },
    ]);
  });

  it("A1208 portionIdentities: a measured dish lists its one measured portion", () => {
    const wine = dish("wine", { quantity: 200000, unitName: { en: "ml" }, lineTotal: 600 });
    const out = expandPortionRows([wine], [context(wine)], [false], 1);

    expect(portionIdentities([identity(wine)], [wine], out)).toEqual([
      { ...identity(wine), lineIds: ["wine"], portionIds: [out.portions[0]!.portionId] },
    ]);
  });
});

describe("A803 portions: recording portions", () => {
  const suite = useVenueDb({
    migrations: migrationOptionsFor(manifestSets(), null),
    timeoutMs: 60_000,
  });
  let db: Database;
  let cfg: DeviceRequestConfig;
  let offers: ZoneOffers;
  let ids: { burger: string; cheese: string; toppings: string; wine: string };
  let catalogueId: string;

  beforeAll(() => {
    db = suite.db;
    useSplitExtrasDb(db);
  });

  beforeEach(async () => {
    const venue = await setupVenue();
    cfg = venue.cfg;
    catalogueId = venue.catalogueId;
    ids = await withTransaction(db, async (tx) => {
      const { defaultLanguage } = await readContentLanguages(tx, cfg.locale);
      const product = async (name: string, price: string) =>
        (
          await createProduct(tx, {
            catalogueId: venue.catalogueId,
            categoryId: null,
            name,
            customerName: { [defaultLanguage]: `${name} (customer)` },
            kitchenName: name.toUpperCase(),
            pricingUnit: "each",
            unitPrice: price,
            vatClass: "reduced",
          })
        ).id;
      const burger = await product("Burger", "5.00");
      const cheese = await product("Cheese", "0.50");
      const wine = await product("Wine", "0.03");
      const ml = await createUnit(
        tx,
        {
          staffName: "Millilitre",
          staffAbbreviation: "ml",
          name: { [defaultLanguage]: "Millilitre" },
          abbreviation: { [defaultLanguage]: "ml" },
          precision: 0,
          measure: true,
        },
        cfg.locale,
      );
      await assignProductUnit(tx, wine, ml.id);
      const toppings = (
        await createExtraList(
          tx,
          {
            name: "Toppings",
            customerName: null,
            kitchenName: null,
            minPicks: 0,
            maxPicks: null,
            active: true,
            items: [{ productId: cheese, maxQuantity: 2, preselected: false, price: null }],
          },
          cfg.locale,
        )
      ).id;
      await writeProductModifiers(tx, burger, [{ kind: "extras", id: toppings }]);
      offers = await offerProducts(tx, cfg, { zone: "tables" });
      return { burger, cheese, toppings, wine };
    });
  });

  async function bill(tx: Transaction): Promise<string> {
    const table = await createTable(tx, cfg, {
      label: `Portions ${randomUUID()}`,
      zoneId: offers.zoneId,
    });
    return (await openPartyTab(tx, cfg, { tableId: table.id })).tabId;
  }

  /** A round of `burgers` burgers (two unless named) with a cheese each and 200 ml of wine, split and
   * written. */
  async function writeRound(tx: Transaction, billId: string, burgers = 2) {
    const round = await priceTabRound(
      tx,
      cfg,
      billId,
      offers.toOfferLines([
        {
          productId: ids.burger,
          quantity: String(burgers),
          extras: [{ listId: ids.toppings, picks: [{ productId: ids.cheese, quantity: 1 }] }],
        },
        { productId: ids.wine, quantity: "200" },
      ]),
    );
    const out = expandPortionRows(round.rows, round.lineContexts, round.portionable, 1);
    await insertTabRound(tx, cfg, { ...round, lineContexts: out.lineContexts }, out.rows);
    return { round, out };
  }

  async function registryRows(tx: Transaction, portions: readonly PortionRef[]) {
    return tx
      .select()
      .from(orderPortions)
      .where(
        inArray(
          orderPortions.id,
          portions.map((portion) => portion.portionId),
        ),
      );
  }

  it("A803 portions: pricing marks whole-portion dishes, never extras or a measure in a unit with no decimals", async () => {
    await withTransaction(db, async (tx) => {
      const { round, out } = await writeRound(tx, await bill(tx));
      expect(round.rows.map((row) => [row.name, row.quantity])).toEqual([
        ["Burger", 2000],
        ["Cheese", 2000],
        ["Wine", 200000],
      ]);
      expect(round.portionable).toEqual([true, false, false]);
      expect(out.rows.map((row) => [row.name, row.quantity])).toEqual([
        ["Burger", 1000],
        ["Cheese", 1000],
        ["Burger", 1000],
        ["Cheese", 1000],
        ["Wine", 200000],
      ]);
      expect(out.portions.map((portion) => portion.measured)).toEqual([false, false, true]);
    });
  });

  it("A803 portions: registering writes one binding per dish line and none for extras", async () => {
    await withTransaction(db, async (tx) => {
      const billId = await bill(tx);
      const { out } = await writeRound(tx, billId);
      await registerPortions(tx, out.portions);

      const lines = await tx
        .select({ id: workingOrderLines.id, parentLineId: workingOrderLines.parentLineId })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, billId));
      const bound = await tx
        .select()
        .from(workingLinePortions)
        .where(
          inArray(
            workingLinePortions.workingOrderLineId,
            lines.map((line) => line.id),
          ),
        );
      expect(bound.map((row) => row.workingOrderLineId).sort()).toEqual(
        lines
          .filter((line) => line.parentLineId === null)
          .map((line) => line.id)
          .sort(),
      );
      expect(await registryRows(tx, out.portions)).toHaveLength(3);
      const read = await readPortionBindings(
        tx,
        lines.map((line) => line.id),
      );
      expect([...read.values()].sort((a, b) => a.lineId.localeCompare(b.lineId))).toEqual(
        out.portions
          .map((portion) => ({
            lineId: portion.lineId,
            portionId: portion.portionId,
            cohortId: portion.pricingCohortId,
            ordinal: portion.ordinal,
          }))
          .sort((a, b) => a.lineId.localeCompare(b.lineId)),
      );
    });
  });

  it("A1208 registerPortions: six portions cost the statements two do", async () => {
    const statementsFor = (burgers: number) =>
      withTransaction(db, async (tx) => {
        const { out } = await writeRound(tx, await bill(tx), burgers);
        const session = (
          tx as unknown as { session: { prepareQuery: (query: { sql: string }) => unknown } }
        ).session;
        const prepared = vi.spyOn(session, "prepareQuery");
        await registerPortions(tx, out.portions);
        const count = prepared.mock.calls.length;
        prepared.mockRestore();
        expect(await registryRows(tx, out.portions)).toHaveLength(out.portions.length);
        expect(
          await tx
            .select()
            .from(workingLinePortions)
            .where(
              inArray(
                workingLinePortions.portionId,
                out.portions.map((portion) => portion.portionId),
              ),
            ),
        ).toHaveLength(out.portions.length);
        return { portions: out.portions.length, count };
      });

    const few = await statementsFor(1);
    const many = await statementsFor(5);
    expect([few.portions, many.portions]).toEqual([2, 6]);
    expect(many.count).toBe(few.count);
  });

  it("A1208 portionIdentities: matches the stored readers, two extras on a dish and the same dish on two request lines kept apart", async () => {
    await withTransaction(db, async (tx) => {
      const billId = await bill(tx);
      const { defaultLanguage } = await readContentLanguages(tx, cfg.locale);
      const bacon = (
        await createProduct(tx, {
          catalogueId,
          categoryId: null,
          name: "Bacon",
          customerName: { [defaultLanguage]: "Bacon (customer)" },
          kitchenName: "BACON",
          pricingUnit: "each",
          unitPrice: "0.75",
          vatClass: "reduced",
        })
      ).id;
      const sides = (
        await createExtraList(
          tx,
          {
            name: "Sides",
            customerName: null,
            kitchenName: null,
            minPicks: 0,
            maxPicks: null,
            active: true,
            items: [{ productId: bacon, maxQuantity: 2, preselected: false, price: null }],
          },
          cfg.locale,
        )
      ).id;
      await writeProductModifiers(tx, ids.burger, [
        { kind: "extras", id: ids.toppings },
        { kind: "extras", id: sides },
      ]);
      const published = await offerProducts(tx, cfg, { zone: "tables" });
      const priced = await priceOrderLines(
        tx,
        cfg,
        billId,
        published.toOfferLines([
          {
            productId: ids.burger,
            quantity: "2",
            extras: [
              { listId: sides, picks: [{ productId: bacon, quantity: 2 }] },
              { listId: ids.toppings, picks: [{ productId: ids.cheese, quantity: 1 }] },
            ],
          },
          { productId: ids.burger, quantity: "1" },
          { productId: ids.wine, quantity: "200" },
        ]),
        published.zoneId,
      );
      const out = expandPortionRows(priced.lineRows, priced.lineContexts, priced.portionable, 1);
      await tx.insert(workingOrderLines).values(out.rows);
      await registerPortions(tx, out.portions);

      const stored = (await readStoredOrder(tx, billId)).identities;
      expect(stored).toHaveLength(5);
      expect(portionIdentities(priced.identities, priced.lineRows, out)).toEqual(stored);
    });
  });

  it("A803 portions: registering again writes nothing, not even a registry row", async () => {
    await withTransaction(db, async (tx) => {
      const { out } = await writeRound(tx, await bill(tx));
      await registerPortions(tx, out.portions);
      const before = await tx.select().from(orderPortions);
      await registerPortions(tx, out.portions);
      expect(await tx.select().from(orderPortions)).toEqual(before);
      expect(await tx.select().from(workingLinePortions)).toHaveLength(3);
    });
  });

  it("A803 portions: registering a line already bound to another portion is refused", async () => {
    await withTransaction(db, async (tx) => {
      const { out } = await writeRound(tx, await bill(tx));
      await registerPortions(tx, out.portions);
      const [first] = out.portions;
      await expect(
        registerPortions(tx, [{ ...first!, portionId: randomUUID(), ordinal: 9 }]),
      ).rejects.toThrow(`registerPortions: line ${first!.lineId} already holds portion`);
      expect(await registryRows(tx, out.portions)).toHaveLength(3);
    });
  });

  it("A803 portions: deleting bindings lets their lines go, and keeps the registry", async () => {
    await withTransaction(db, async (tx) => {
      const { out } = await writeRound(tx, await bill(tx));
      await registerPortions(tx, out.portions);
      const [first, second] = out.portions;
      await deletePortionBindings(tx, [first!.lineId]);

      const left = await readPortionBindings(tx, [first!.lineId, second!.lineId]);
      expect([...left.keys()]).toEqual([second!.lineId]);
      expect(await registryRows(tx, out.portions)).toHaveLength(3);
      await tx.delete(workingOrderLines).where(eq(workingOrderLines.parentLineId, first!.lineId));
      await tx.delete(workingOrderLines).where(eq(workingOrderLines.id, first!.lineId));
      // Still bound: the binding's key to its line refuses the delete.
      await tx.delete(workingOrderLines).where(eq(workingOrderLines.parentLineId, second!.lineId));
      await expect(
        tx.delete(workingOrderLines).where(eq(workingOrderLines.id, second!.lineId)),
      ).rejects.toThrow(/FOREIGN KEY/);
    });
  });
});
