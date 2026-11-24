import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { products, readHistoryNodes } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { menuItems } from "@waitron/menu";
import {
  computeCategorySales,
  computeTopSellers,
  currentBusinessDay,
  resolveVenueClock,
} from "@waitron/reporting";
import { nodeId as brandNodeId, subtractDecimal, decimal } from "@waitron/shared";
import { creditWholeInvoice, readOrderInvoice } from "./cancel-credit.js";
import { readOrderDetail } from "./orders-list.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { inTx, type PartyVenue } from "./testing/party-venue.js";
import {
  addSpecLunch,
  lunchBill,
  printSpecBill,
  setupSetMenuSpecVenue,
  specDeps,
  type SpecLunch,
  type SpecVenue,
} from "./testing/set-menu-spec-fixture.js";
import "./errors.js";

// VAT rates piece B, S11: the reports and the order detail of a takeaway set menu whose price was
// divided between dishes at 10% and 21% (the plan's worked example), from the rows really filed.
let spec: SpecVenue;
let venue: PartyVenue;
let lunch: SpecLunch;
const PRICES = [
  ["Soup", 550],
  ["Hake", 1250],
] as const;
let before: Map<string, number | null>;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    spec = await setupSetMenuSpecVenue(db);
    venue = spec.venue;
  },
});

function setPrices(prices: readonly (readonly [keyof SpecVenue["productIds"], number | null])[]) {
  return inTx(venue, async (tx) => {
    for (const [dish, price] of prices)
      await tx
        .update(products)
        .set({ unitPrice: price })
        .where(eq(products.id, spec.productIds[dish]));
  });
}

beforeAll(async () => {
  lunch = await addSpecLunch(spec);
  const rows = await venue.db.select({ id: products.id, price: products.unitPrice }).from(products);
  before = new Map(rows.map(({ id, price }) => [id, price]));
  await setPrices(PRICES);
});

afterAll(async () => {
  await setPrices(PRICES.map(([dish]) => [dish, before.get(spec.productIds[dish])!] as const));
});

function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Category sales (gross and net by group, and the totals) and top sellers by name, around today. */
function reports() {
  return inTx(venue, async (tx) => {
    const nodeId = brandNodeId(venue.cfg.nodeId);
    const clock = await resolveVenueClock(tx, nodeId);
    const day = currentBusinessDay(clock);
    const common = {
      nodeIds: await readHistoryNodes(tx, nodeId),
      fromBusinessDay: shiftDay(day, -1),
      toBusinessDay: shiftDay(day, 1),
      timeZone: clock.timeZone,
      dayCutover: clock.dayCutover,
      cutoverChanges: clock.cutoverChanges,
    };
    const categories = await computeCategorySales(tx, { ...common, mode: "at_time_of_sale" });
    const sellers = await computeTopSellers(tx, { ...common, limit: 1000 });
    return {
      groups: new Map(
        categories.tree.map((node) => [
          node.kind === "category" ? node.name : node.kind,
          [node.gross, node.net],
        ]),
      ),
      totals: [categories.gross, categories.net],
      sellers: new Map(sellers.map((row) => [row.name, [row.quantity, row.total]])),
    };
  });
}

type Reports = Awaited<ReturnType<typeof reports>>;

/** What each named figure moved by between two reads; a figure that did not move is left out. */
function moved(from: Reports, to: Reports) {
  const delta = (
    a: ReadonlyMap<string, readonly string[]>,
    b: ReadonlyMap<string, readonly string[]>,
  ) =>
    Object.fromEntries(
      [...b].flatMap(([name, figures]) => {
        const was = a.get(name) ?? figures.map(() => "0");
        const by = figures.map((figure, at) =>
          String(subtractDecimal(decimal(figure), decimal(was[at]!))),
        );
        return by.every((figure) => Number(figure) === 0) ? [] : [[name, by]];
      }),
    );
  return {
    groups: delta(from.groups, to.groups),
    totals: to.totals.map((figure, at) =>
      String(subtractDecimal(decimal(figure), decimal(from.totals[at]!))),
    ),
    sellers: delta(from.sellers, to.sellers),
  };
}

async function detailOf(billId: string) {
  const detail = await inTx(venue, (tx) => readOrderDetail(tx, billId, "all", false));
  return detail.lines.map((line) => [line.name, String(line.total)]);
}

/** Hake costs `cents` more in the Lunch menu; answers the published copy's id. */
function hakeSupplement(cents: number | null) {
  return inTx(venue, async (tx) => {
    await tx.update(menuItems).set({ grossPrice: cents }).where(eq(menuItems.id, lunch.items.Hake));
    return publishWorkingMenu(tx, venue.tables.menuId);
  });
}

describe("reports of a takeaway set menu divided between 10% and 21%", () => {
  it("count the set menu at 14.00 under Set menus and its dishes at 0.00", async () => {
    const start = await reports();
    const bill = await lunchBill(spec, lunch);
    await printSpecBill(spec, bill.partyId, bill.tabId);

    expect(moved(start, await reports())).toEqual({
      groups: { set_menus: ["14.00", "12.53"] },
      totals: ["14.00", "12.53"],
      sellers: {
        "Lunch menu": ["1.000", "12.53"],
        Soup: ["1.000", "0.00"],
        Hake: ["1.000", "0.00"],
        Lemonade: ["1.000", "0.00"],
      },
    });
    expect(await detailOf(bill.tabId)).toEqual([
      ["Lunch menu", "14.00"],
      ["Soup", "0.00"],
      ["Hake", "0.00"],
      ["Lemonade", "0.00"],
    ]);
  });

  it("count a 2.00 supplement on hake under hake's category", async () => {
    const [{ grossPrice }] = await venue.db
      .select({ grossPrice: menuItems.grossPrice })
      .from(menuItems)
      .where(eq(menuItems.id, lunch.items.Hake));
    const versionId = await hakeSupplement(200);
    try {
      const start = await reports();
      const bill = await lunchBill(spec, lunch, versionId);
      await printSpecBill(spec, bill.partyId, bill.tabId);

      expect(moved(start, await reports())).toEqual({
        groups: { set_menus: ["14.00", "12.53"], "Set menu dishes": ["2.00", "1.82"] },
        totals: ["16.00", "14.35"],
        sellers: {
          "Lunch menu": ["1.000", "12.53"],
          Soup: ["1.000", "0.00"],
          Hake: ["1.000", "1.82"],
          Lemonade: ["1.000", "0.00"],
        },
      });
      expect(await detailOf(bill.tabId)).toEqual([
        ["Lunch menu", "14.00"],
        ["Soup", "0.00"],
        ["Hake", "2.00"],
        ["Lemonade", "0.00"],
      ]);
    } finally {
      lunch.versionId = await hakeSupplement(grossPrice);
    }
  });

  it("take a whole credit back off Set menus and the set menu's top-seller total", async () => {
    const bill = await lunchBill(spec, lunch);
    await printSpecBill(spec, bill.partyId, bill.tabId);
    const start = await reports();
    await inTx(venue, async (tx) =>
      creditWholeInvoice(tx, specDeps(spec), venue.cfg, (await readOrderInvoice(tx, bill.tabId))!, {
        sessionId: venue.operator.sessionId,
      }),
    );

    expect(moved(start, await reports())).toEqual({
      groups: { set_menus: ["-14.00", "-12.53"] },
      totals: ["-14.00", "-12.53"],
      sellers: {
        "Lunch menu": ["-1.000", "-12.53"],
        Soup: ["-1.000", "0.00"],
        Hake: ["-1.000", "0.00"],
        Lemonade: ["-1.000", "0.00"],
      },
    });
  });
});
