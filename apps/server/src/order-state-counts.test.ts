import { placeOrder } from "./testing/order-writer-fixture.js";
import { setRoutingCell } from "@waitron/venue-service";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  floorZones,
  lineServiceCancellations,
  nowIso,
  orderDrafts,
  parties,
  products,
  ticketItems,
  workingOrderLines,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  assignProductUnit,
  createExtraList,
  createProduct,
  createUnit,
  setProductVariants,
  units,
  writeProductModifiers,
} from "@waitron/catalogue";
import {
  advanceTicketItem,
  listHeldOrders,
  markCollected,
  markServed,
  parkOrder,
} from "./working-order.js";
import { createStation } from "./kitchen.js";
import { readBillEditState } from "./bill-editing.js";
import { recallToDraft } from "./draft-recall.js";
import { seatTable } from "./parties.js";
import { readHeldCounts } from "./order-groups.js";
import { VENUE_SERVICE } from "./modules.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { saveDraftForTest as saveDraft } from "./testing/draft-command-fixture.js";
import { createTable } from "./testing/live-table.js";
import { serveLine } from "./testing/serve-line.js";
import { routeProductTo } from "./testing/zone-offers.js";
import { inTx, provisionBillVenue } from "./testing/bill-venue.js";
import type { BillVenue } from "./testing/bill-venue.js";
import { republishMenus } from "./testing/publish-menu.js";
import { dishCounts, readOrderStateCounts } from "./order-state-counts.js";
import type { CountedLine } from "./order-state-counts.js";
import "./errors.js";

let venue: BillVenue;
let pulpoLarge: string;
let sauces: { listId: string; productId: string };
const zones = {} as Record<"prepay" | "ticket_then_pay", string>;

/** Each test parks its own orders; the units are given to dishes no other test orders. */
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    for (const mode of ["prepay", "ticket_then_pay"] as const) {
      zones[mode] = await inTx(venue, async (tx) => {
        const [zone] = await tx
          .insert(floorZones)
          .values({ locationId: venue.cfg.locationId, name: `Bar ${mode}` })
          .returning({ id: floorZones.id });
        await offerProducts(tx, venue.cfg, { zone: { zoneId: zone!.id }, orderStart: "counter" });
        if (mode === "ticket_then_pay") {
          await tx.execute(sql`
            update zone_sale_policies set paid_when = 'ticket_then_pay'
            where zone_id = ${zone!.id}`);
        }
        return zone!.id;
      });
    }
    await inTx(venue, async (tx) => {
      const cana = await productOf(tx, "Caña");
      await setRoutingCell(
        tx,
        venue.cfg,
        { row: { kind: "product", productId: cana }, zoneId: null },
        { kind: "no_preparation" },
      );
      const text = (word: string) => ({ en: word });
      const [gram] = await tx
        .insert(units)
        .values({
          staffName: "Gram",
          staffAbbreviation: "g",
          name: text("g"),
          abbreviation: text("g"),
          precision: 0,
          hardwareUnit: "g",
        })
        .returning({ id: units.id });
      const [kilo] = await tx
        .insert(units)
        .values({
          staffName: "Kilo",
          staffAbbreviation: "kg",
          name: text("kg"),
          abbreviation: text("kg"),
          precision: 3,
          hardwareUnit: "kg",
        })
        .returning({ id: units.id });
      const ml = await createUnit(
        tx,
        {
          staffName: "Millilitre",
          staffAbbreviation: "ml",
          name: text("ml"),
          abbreviation: text("ml"),
          precision: 0,
          measure: true,
        },
        "en",
      );
      const tenth = await createUnit(
        tx,
        {
          staffName: "Tenth",
          staffAbbreviation: "t",
          name: text("t"),
          abbreviation: text("t"),
          precision: 1,
        },
        "en",
      );
      await assignProductUnit(tx, await productOf(tx, "Paella"), gram!.id);
      await assignProductUnit(tx, await productOf(tx, "Chuletón"), ml.id);
      await assignProductUnit(tx, await productOf(tx, "Ensalada"), kilo!.id);
      await assignProductUnit(tx, await productOf(tx, "Croquetas"), tenth.id);
      const pulpo = await productOf(tx, "Pulpo");
      await assignProductUnit(tx, pulpo, gram!.id);
      const [large] = await setProductVariants(
        tx,
        pulpo,
        [
          {
            name: "Large",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: "30.00",
            available: true,
          },
        ],
        "en",
      );
      pulpoLarge = large!.id;
      const tarta = await productOf(tx, "Tarta");
      const [{ catalogueId, categoryId }] = await tx
        .select({ catalogueId: products.catalogueId, categoryId: products.categoryId })
        .from(products)
        .where(eq(products.id, tarta));
      const sauce = await createProduct(tx, {
        catalogueId,
        categoryId: categoryId!,
        name: "Pepper sauce",
        customerName: { "es-ES": "Pepper sauce" },
        kitchenName: "PEPPER",
        pricingUnit: "each",
        unitPrice: "1.50",
        vatClass: "general",
      });
      const list = await createExtraList(
        tx,
        {
          name: "Sauces",
          customerName: null,
          kitchenName: null,
          minPicks: 0,
          maxPicks: 1,
          active: true,
          items: [{ productId: sauce.id, maxQuantity: 1, preselected: false, price: "1.50" }],
        },
        "es-ES",
      );
      await writeProductModifiers(tx, tarta, [{ kind: "extras", id: list.id }]);
      const grill = await createStation(tx, venue.cfg, { name: "Grill" });
      await routeProductTo(tx, venue.cfg, sauce.id, grill.id);
      sauces = { listId: list.id, productId: sauce.id };
      await republishMenus(tx);
    });
  },
});

async function productOf(tx: Parameters<Parameters<typeof inTx>[1]>[0], name: string) {
  const [item] = (
    await tx.execute<{ product_id: string }>(
      sql`select product_id from menu_items where id = ${venue.offerFor(name)}`,
    )
  ).rows;
  return item!.product_id;
}

const deps = () => ({ db: venue.db, backend: venue.backend, clock: venue.clock });

async function parked(
  lines: [name: string, quantity: string][],
  mode: "prepay" | "ticket_then_pay" = "prepay",
): Promise<string> {
  const id = randomUUID();
  await parkOrder(deps(), venue.cfg, {
    id,
    zoneId: zones[mode],
    lines: lines.map(([name, quantity]) => ({ menuItemId: venue.offerFor(name), quantity })),
    operatorId: venue.operatorId,
  });
  return id;
}

function countsOf(ids: string[]) {
  return inTx(venue, (tx) => readOrderStateCounts(tx, ids));
}

const zero = { ordered: 0, unsent: 0, held: 0, waiting: 0, ready: 0 };

/** A dish of Each, ordered 1, sent to a station and queued there, nothing served. */
function dish(overrides: Partial<CountedLine> = {}): CountedLine {
  return {
    quantity: 1000,
    cancelled: 0,
    servedQuantity: 0,
    servedAt: null,
    unitPrecision: 0,
    unit: null,
    recalled: false,
    sentAt: nowIso(),
    groupState: null,
    ticket: { madeHere: false, firedAt: nowIso(), state: "queued" },
    ...overrides,
  };
}

const unfired = { madeHere: false, firedAt: null, state: "queued" } as const;
const readyHere = { madeHere: true, firedAt: nowIso(), state: "ready" } as const;

// The rules this mirrors: `unsentDishLines`, `isReleased` and `takesExtras` in working-order.ts,
// and `heldExtras` in order-groups.ts.
describe("dishCounts", () => {
  it("counts a dish with no kitchen item, group or send as unsent", () => {
    expect(dishCounts(dish({ sentAt: null, ticket: null }), [], false)).toEqual({
      ...zero,
      ordered: 1,
      unsent: 1,
    });
  });

  it("counts a recalled dish as unsent though it was sent", () => {
    expect(dishCounts(dish({ recalled: true }), [], false)).toEqual({
      ...zero,
      ordered: 1,
      unsent: 1,
    });
  });

  it("counts a dish in a held group as held", () => {
    expect(dishCounts(dish({ groupState: "held", ticket: unfired }), [], false)).toEqual({
      ...zero,
      ordered: 1,
      held: 1,
    });
  });

  it("counts a dish with no kitchen item in a held group as held", () => {
    expect(dishCounts(dish({ sentAt: null, groupState: "held", ticket: null }), [], false)).toEqual(
      { ...zero, ordered: 1, held: 1 },
    );
  });

  it("counts a dish whose own item is unfired as held, though queued", () => {
    expect(dishCounts(dish({ ticket: unfired }), [], false)).toEqual({
      ...zero,
      ordered: 1,
      held: 1,
    });
  });

  it("counts a made-here dish with an unfired extra as held", () => {
    expect(dishCounts(dish({ ticket: readyHere }), [{ ticket: unfired }], false)).toEqual({
      ...zero,
      ordered: 1,
      held: 1,
    });
  });

  it("counts a made-here dish in a held group as ready", () => {
    expect(dishCounts(dish({ groupState: "held", ticket: readyHere }), [], false)).toEqual({
      ...zero,
      ordered: 1,
      ready: 1,
    });
  });

  it("counts a fired, queued or preparing dish as waiting", () => {
    expect(dishCounts(dish(), [], false)).toEqual({ ...zero, ordered: 1, waiting: 1 });
    const preparing = { madeHere: false, firedAt: nowIso(), state: "preparing" } as const;
    expect(dishCounts(dish({ ticket: preparing }), [], false)).toEqual({
      ...zero,
      ordered: 1,
      waiting: 1,
    });
  });

  it("counts a ready dish with a fired extra still queued as waiting", () => {
    const ready = { madeHere: false, firedAt: nowIso(), state: "ready" } as const;
    const queued = { madeHere: false, firedAt: nowIso(), state: "queued" } as const;
    expect(dishCounts(dish({ ticket: ready }), [{ ticket: queued }], false)).toEqual({
      ...zero,
      ordered: 1,
      waiting: 1,
    });
  });

  it("counts a dish whose every kitchen part is ready as ready", () => {
    const ready = { madeHere: false, firedAt: nowIso(), state: "ready" } as const;
    expect(
      dishCounts(dish({ ticket: ready }), [{ ticket: ready }, { ticket: null }], false),
    ).toEqual({ ...zero, ordered: 1, ready: 1 });
  });

  it("counts a sent dish with no kitchen work as ready", () => {
    expect(dishCounts(dish({ ticket: null }), [], false)).toEqual({
      ...zero,
      ordered: 1,
      ready: 1,
    });
  });

  it("counts a handed-over order's dish as ordered only", () => {
    expect(dishCounts(dish({ quantity: 3000 }), [], true)).toEqual({ ...zero, ordered: 3 });
  });

  it("counts a served dish as ordered only", () => {
    expect(dishCounts(dish({ servedAt: nowIso(), servedQuantity: 0 }), [], false)).toEqual({
      ...zero,
      ordered: 1,
    });
  });

  it("counts a part-served dish by the whole units still to serve, rounded up", () => {
    expect(dishCounts(dish({ quantity: 3000, servedQuantity: 1500 }), [], false)).toEqual({
      ...zero,
      ordered: 3,
      waiting: 2,
    });
  });

  it("counts a negative served quantity as nothing served", () => {
    expect(dishCounts(dish({ servedQuantity: -500 }), [], false)).toEqual({
      ...zero,
      ordered: 1,
      waiting: 1,
    });
  });

  it("counts cancellations out, and no more left than ordered", () => {
    expect(
      dishCounts(dish({ quantity: 3000, cancelled: 1000, servedQuantity: 500 }), [], false),
    ).toEqual({ ...zero, ordered: 2, waiting: 2 });
    expect(dishCounts(dish({ quantity: 2000, cancelled: 2000 }), [], false)).toEqual(zero);
  });

  it("counts a dish not sold by the unit as one", () => {
    const grams = { hardwareUnit: "g", precision: 0, measure: false };
    expect(dishCounts(dish({ quantity: 150_000, unit: grams }), [], false)).toEqual({
      ...zero,
      ordered: 1,
      waiting: 1,
    });
    const tenths = { hardwareUnit: null, precision: 1, measure: false };
    expect(
      dishCounts(dish({ quantity: 2000, unitPrecision: null, unit: tenths }), [], false),
    ).toEqual({ ...zero, ordered: 1, waiting: 1 });
    expect(dishCounts(dish({ quantity: 2000, unitPrecision: 1 }), [], false)).toEqual({
      ...zero,
      ordered: 1,
      waiting: 1,
    });
  });

  it("counts a fractional quantity of a dish sold by the unit as one", () => {
    expect(dishCounts(dish({ quantity: 1500, unitPrecision: null }), [], false)).toEqual({
      ...zero,
      ordered: 1,
      waiting: 1,
    });
  });
});

describe("readOrderStateCounts", () => {
  it("counts a parked order's dishes by quantity, all unsent", async () => {
    const id = await parked([
      ["Tarta", "2"],
      ["Caña", "3"],
    ]);
    expect(await countsOf([id])).toEqual(new Map([[id, { ...zero, ordered: 5, unsent: 5 }]]));
  });

  it("counts a 150 g dish as one", async () => {
    const id = await parked([["Paella", "150"]]);
    expect(await countsOf([id])).toEqual(new Map([[id, { ...zero, ordered: 1, unsent: 1 }]]));
  });

  it("counts a 330 ml dish as one", async () => {
    const id = await parked([["Chuletón", "330"]]);
    expect(await countsOf([id])).toEqual(new Map([[id, { ...zero, ordered: 1, unsent: 1 }]]));
  });

  it("counts a 0.450 kg dish as one", async () => {
    const id = await parked([["Ensalada", "0.450"]]);
    expect(await countsOf([id])).toEqual(new Map([[id, { ...zero, ordered: 1, unsent: 1 }]]));
  });

  it("counts 1.5 of a dish in a unit with one decimal place as one", async () => {
    const id = await parked([["Croquetas", "1.5"]]);
    expect(await countsOf([id])).toEqual(new Map([[id, { ...zero, ordered: 1, unsent: 1 }]]));
  });

  it("counts a line of 1.5 with no frozen places as one", async () => {
    const id = await parked([["Tarta", "1"]]);
    await inTx(venue, (tx) =>
      tx
        .update(workingOrderLines)
        .set({ quantity: 1500, unitPrecision: null })
        .where(eq(workingOrderLines.workingOrderId, id)),
    );
    expect(await countsOf([id])).toEqual(new Map([[id, { ...zero, ordered: 1, unsent: 1 }]]));
  });

  it("counts 150 g of a variant as one, reading its parent's unit", async () => {
    const id = randomUUID();
    await parkOrder(deps(), venue.cfg, {
      id,
      zoneId: zones.prepay,
      lines: [{ menuItemId: venue.offerFor("Pulpo"), variantId: pulpoLarge, quantity: "150" }],
      operatorId: venue.operatorId,
    });
    expect(await countsOf([id])).toEqual(new Map([[id, { ...zero, ordered: 1, unsent: 1 }]]));
  });

  it("counts by the line's frozen places, not its unit's current ones", async () => {
    const id = await parked([["Croquetas", "2"]]);
    await inTx(venue, (tx) =>
      tx
        .update(workingOrderLines)
        .set({ unitPrecision: 0 })
        .where(eq(workingOrderLines.workingOrderId, id)),
    );
    expect(await countsOf([id])).toEqual(new Map([[id, { ...zero, ordered: 2, unsent: 2 }]]));
  });

  it("counts whole units only, because 1.5 of a dish with no decimal places is refused", async () => {
    await expect(parked([["Tarta", "1.5"]])).rejects.toMatchObject({ code: "quantity.invalid" });
  });

  it("counts a sent order's dish as waiting, and a handed-over one as ordered only", async () => {
    const id = await parked([["Tarta", "1"]], "ticket_then_pay");
    await placeOrder(deps(), venue.cfg, id, venue.operatorId);
    expect(await countsOf([id])).toEqual(new Map([[id, { ...zero, ordered: 1, waiting: 1 }]]));

    await markCollected({ db: venue.db }, venue.cfg, id);
    expect(await countsOf([id])).toEqual(new Map([[id, { ...zero, ordered: 1 }]]));
  });

  it("counts all zeros for an order with no lines", async () => {
    const id = randomUUID();
    venue.db.run(sql`
      insert into working_orders (id, source, device_id, location_id, node_id, order_number, status, opened_at)
      values (${id}, 'device', ${venue.cfg.origin.deviceId}, ${venue.cfg.locationId}, ${venue.cfg.nodeId}, 90001, 'open', ${nowIso()})`);
    expect(await countsOf([id])).toEqual(new Map([[id, zero]]));
  });

  it("counts any number of orders in the same statements, and none for an empty list", async () => {
    const ids = [
      await parked([["Tarta", "1"]]),
      await parked([["Caña", "2"]]),
      await parked([["Tarta", "1"]]),
    ];
    const statementsFor = (orderIds: string[]) =>
      inTx(venue, async (tx) => {
        const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
        try {
          const counts = await readOrderStateCounts(tx, orderIds);
          return { counts, statements: prepare.mock.calls.length };
        } finally {
          prepare.mockRestore();
        }
      });

    const one = await statementsFor(ids.slice(0, 1));
    const three = await statementsFor(ids);
    const none = await statementsFor([]);

    expect(one.statements).toBeGreaterThan(0);
    expect(three.statements).toBe(one.statements);
    expect([...three.counts.keys()]).toEqual(ids);
    expect(none).toEqual({ counts: new Map(), statements: 0 });
  });
});

type Line = Parameters<typeof addTabRound>[3][number];

const withSauce = (name: string, quantity = "1"): Line => ({
  menuItemId: venue.offerFor(name),
  quantity,
  extras: [{ listId: sauces.listId, picks: [{ productId: sauces.productId, quantity: 1 }] }],
});
const plain = (name: string, quantity = "1"): Line => ({
  menuItemId: venue.offerFor(name),
  quantity,
});

async function seatParty(): Promise<{ partyId: string; billId: string }> {
  return inTx(venue, async (tx) => {
    const table = await createTable(tx, venue.cfg, {
      label: `T-${randomUUID().slice(0, 8)}`,
      zoneId: venue.zoneId,
    });
    const { partyId, tabId } = await seatTable(tx, venue.cfg, {
      tableId: table.id,
      guestCount: null,
      operatorId: venue.operatorId,
    });
    await VENUE_SERVICE.writePartyAllergy(
      tx,
      partyId,
      { answer: "none", guests: [] },
      venue.operatorId,
    );
    return { partyId, billId: tabId };
  });
}

async function command(tx: Transaction, partyId: string) {
  const [row] = await tx
    .select({ revision: parties.revision })
    .from(parties)
    .where(eq(parties.id, partyId));
  return {
    submissionId: randomUUID(),
    expectedPartyRevision: row!.revision,
    operatorId: venue.operatorId,
  };
}

function sendRound(billId: string, lines: Line[]) {
  return inTx(venue, (tx) => addTabRound(tx, venue.cfg, billId, lines));
}

async function holdGroup(partyId: string, lines: Line[]): Promise<string> {
  const placed = await inTx(venue, (tx) =>
    placeGroups(tx, venue.cfg, partyId, {
      groups: [{ lines, release: "hold" }],
      operatorId: venue.operatorId,
    }),
  );
  return placed.groups[0]!.id;
}

/** The bill's dish's kitchen item, and its first extra's. */
async function kitchenItems(billId: string) {
  const rows = await inTx(venue, (tx) =>
    tx
      .select({
        id: ticketItems.id,
        lineId: ticketItems.workingOrderLineId,
        parentLineId: workingOrderLines.parentLineId,
        state: ticketItems.state,
      })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .where(eq(ticketItems.workingOrderId, billId))
      .orderBy(workingOrderLines.lineNo),
  );
  return {
    dish: rows.find((row) => row.parentLineId === null)!,
    extra: rows.find((row) => row.parentLineId !== null),
  };
}

function advance(itemId: string, ...states: ("preparing" | "ready")[]) {
  return inTx(venue, async (tx) => {
    for (const state of states) await advanceTicketItem(tx, venue.cfg, itemId, state);
  });
}

async function dishLines(billId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ id: workingOrderLines.id, lineNo: workingOrderLines.lineNo })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId))
      .orderBy(workingOrderLines.lineNo),
  );
}

async function countsOfBill(billId: string) {
  return (await countsOf([billId])).get(billId);
}

function cancel(lineId: string, quantity: number) {
  return inTx(venue, (tx) =>
    tx.insert(lineServiceCancellations).values({
      lineId,
      quantity,
      cancelledAt: nowIso(),
      wasStarted: false,
      actorId: venue.operatorId,
    }),
  );
}

function draftLine(name: string, quantity = "1") {
  return {
    menuItemId: venue.offerFor(name),
    variantId: null,
    menuVersionId: null,
    options: [],
    extras: [],
    note: null,
    quantity,
    courseId: null,
    noMerge: false,
  };
}

function saveBillDraft(
  partyId: string,
  billId: string,
  lines: ReturnType<typeof draftLine>[],
  draft: { id: string; revision: number } | null = null,
) {
  return inTx(venue, (tx) =>
    saveDraft(tx, venue.cfg, partyId, venue.operatorId, {
      billId,
      draftId: draft?.id ?? null,
      revision: draft?.revision ?? 0,
      lines,
    }),
  );
}

// The rules the kitchen states mirror: `isReleased` in working-order.ts and `heldExtras` and
// `readyAt` in order-groups.ts.
describe("readOrderStateCounts on a party's bill", () => {
  it("counts a held group's dishes as held, extras adding nothing, as readHeldCounts does", async () => {
    const { partyId, billId } = await seatParty();
    await holdGroup(partyId, [withSauce("Tarta", "2"), plain("Ensalada", "0.450")]);

    expect(await countsOfBill(billId)).toEqual({ ...zero, ordered: 3, held: 3 });
    expect(await inTx(venue, (tx) => readHeldCounts(tx, [partyId]))).toEqual(
      new Map([[partyId, 3]]),
    );
  });

  it("counts a dish with no kitchen work in a held group as held, by its group", async () => {
    const { partyId, billId } = await seatParty();
    await holdGroup(partyId, [plain("Caña")]);

    expect(await countsOfBill(billId)).toEqual({ ...zero, ordered: 1, held: 1 });
  });

  it("counts a fired dish waiting while queued or preparing, then ready, then by what is left to serve", async () => {
    const { partyId, billId } = await seatParty();
    await sendRound(billId, [plain("Tarta", "3")]);
    const { dish } = await kitchenItems(billId);
    expect(await countsOfBill(billId)).toEqual({ ...zero, ordered: 3, waiting: 3 });

    await advance(dish.id, "preparing");
    expect(await countsOfBill(billId)).toEqual({ ...zero, ordered: 3, waiting: 3 });

    await advance(dish.id, "ready");
    expect(await countsOfBill(billId)).toEqual({ ...zero, ordered: 3, ready: 3 });

    await inTx(venue, async (tx) =>
      markServed(
        tx,
        venue.cfg,
        partyId,
        [{ lineId: dish.lineId, quantity: "2" }],
        await command(tx, partyId),
      ),
    );
    expect(await countsOfBill(billId)).toEqual({ ...zero, ordered: 3, ready: 1 });

    await inTx(venue, (tx) => serveLine(tx, venue.cfg, billId, 1));
    expect(await countsOfBill(billId)).toEqual({ ...zero, ordered: 3 });
  });

  it("counts a line stamped served as served, whatever its served quantity holds", async () => {
    const { billId } = await seatParty();
    await sendRound(billId, [plain("Tarta", "2")]);
    await inTx(venue, (tx) =>
      tx
        .update(workingOrderLines)
        .set({ servedAt: nowIso(), servedQuantity: 0 })
        .where(eq(workingOrderLines.workingOrderId, billId)),
    );

    expect(await countsOfBill(billId)).toEqual({ ...zero, ordered: 2 });
  });

  it("counts a ready dish waiting while its extra is queued at another station, then ready, and held while the extra is unfired", async () => {
    const { billId } = await seatParty();
    await sendRound(billId, [withSauce("Tarta")]);
    const { dish, extra } = await kitchenItems(billId);
    await advance(dish.id, "preparing", "ready");
    expect(await countsOfBill(billId)).toEqual({ ...zero, ordered: 1, waiting: 1 });

    await advance(extra!.id, "preparing", "ready");
    expect(await countsOfBill(billId)).toEqual({ ...zero, ordered: 1, ready: 1 });

    await inTx(venue, (tx) =>
      tx.update(ticketItems).set({ firedAt: null }).where(eq(ticketItems.id, extra!.id)),
    );
    expect(await countsOfBill(billId)).toEqual({ ...zero, ordered: 1, held: 1 });
  });

  it("counts a made-here dish in a held group as ready", async () => {
    const { partyId, billId } = await seatParty();
    await holdGroup(partyId, [plain("Tarta")]);
    const { dish } = await kitchenItems(billId);
    await inTx(venue, (tx) =>
      tx
        .update(ticketItems)
        .set({ madeHere: true, state: "ready", firedAt: nowIso() })
        .where(eq(ticketItems.id, dish.id)),
    );

    expect(await countsOfBill(billId)).toEqual({ ...zero, ordered: 1, ready: 1 });
  });

  it("counts a sent dish with no preparation as ready", async () => {
    const { billId } = await seatParty();
    await sendRound(billId, [plain("Caña")]);

    expect(await countsOfBill(billId)).toEqual({ ...zero, ordered: 1, ready: 1 });
  });

  it("counts a held dish recalled into a draft as unsent", async () => {
    const { partyId, billId } = await seatParty();
    await holdGroup(partyId, [plain("Tarta")]);
    const [line] = await dishLines(billId);
    await inTx(venue, async (tx) =>
      recallToDraft(tx, venue.cfg, partyId, line!.id, {
        ...(await command(tx, partyId)),
        expectedEdit: await readBillEditState(tx, billId),
      }),
    );

    expect(await countsOfBill(billId)).toEqual({ ...zero, ordered: 1, unsent: 1 });
  });

  it("counts a bill's saved draft dishes as ordered and unsent, apart from its total, until discarded", async () => {
    const { partyId, billId } = await seatParty();
    await sendRound(billId, [plain("Caña")]);
    const totalOf = async () =>
      (await listHeldOrders(deps(), venue.cfg)).find((order) => order.id === billId)!.total;
    const before = await totalOf();

    const draft = await saveBillDraft(partyId, billId, [draftLine("Tarta")]);
    expect(await countsOfBill(billId)).toEqual({ ...zero, ordered: 2, unsent: 1, ready: 1 });
    expect(await totalOf()).toEqual(before);

    await saveBillDraft(
      partyId,
      billId,
      [draftLine("Tarta", "2"), draftLine("Paella", "150")],
      draft,
    );
    expect(await countsOfBill(billId)).toEqual({ ...zero, ordered: 4, unsent: 3, ready: 1 });

    await inTx(venue, (tx) =>
      tx.update(orderDrafts).set({ state: "discarded" }).where(eq(orderDrafts.id, draft.id)),
    );
    expect(await countsOfBill(billId)).toEqual({ ...zero, ordered: 1, ready: 1 });
  });

  it("counts cancellations out: one of three, and a weighed dish cancelled whole", async () => {
    const { billId } = await seatParty();
    await sendRound(billId, [plain("Tarta", "3"), plain("Ensalada", "0.450")]);
    const [tarta, ensalada] = await dishLines(billId);
    await cancel(tarta!.id, 1000);
    expect(await countsOfBill(billId)).toEqual({ ...zero, ordered: 3, waiting: 3 });

    await cancel(ensalada!.id, 450);
    expect(await countsOfBill(billId)).toEqual({ ...zero, ordered: 2, waiting: 2 });
  });

  it("counts three bills, two with drafts, in the same statements as one", async () => {
    const bills = [];
    for (const withDraft of [true, false, true]) {
      const { partyId, billId } = await seatParty();
      await sendRound(billId, [plain("Caña")]);
      if (withDraft) await saveBillDraft(partyId, billId, [draftLine("Tarta")]);
      bills.push(billId);
    }
    const statementsFor = (orderIds: string[]) =>
      inTx(venue, async (tx) => {
        const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
        try {
          const counts = await readOrderStateCounts(tx, orderIds);
          return { counts, statements: prepare.mock.calls.length };
        } finally {
          prepare.mockRestore();
        }
      });

    const one = await statementsFor(bills.slice(0, 1));
    const three = await statementsFor(bills);

    expect(one.counts).toEqual(new Map([[bills[0], { ...zero, ordered: 2, unsent: 1, ready: 1 }]]));
    expect(three.statements).toBe(one.statements);
    expect(three.counts).toEqual(
      new Map([
        [bills[0], { ...zero, ordered: 2, unsent: 1, ready: 1 }],
        [bills[1], { ...zero, ordered: 1, ready: 1 }],
        [bills[2], { ...zero, ordered: 2, unsent: 1, ready: 1 }],
      ]),
    );
  });
});
