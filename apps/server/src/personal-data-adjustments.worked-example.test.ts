import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  adjustments,
  createAdjustmentReason,
  type AdjustmentReasonInput,
} from "@waitron/adjustments";
import { createProduct } from "@waitron/catalogue";
import {
  catalogues,
  categories,
  lineServiceCancellations,
  parties,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { personalDataParts, preparePersonalData } from "@waitron/module";
import { readBillEditState } from "./bill-editing.js";
import { readCancellationContext } from "./line-cancel-context.js";
import { cancelItem, type CancelItemAsk } from "./line-cancel.js";
import { modulesNamed } from "./modules.js";
import { advanceTicketItem } from "./working-order.js";
import {
  billWith,
  inTx,
  provisionAdjustmentVenue,
  PINS,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";
import { offerProducts } from "./testing/zone-offers.js";

// The backlog's worked example (docs/backlog/data-protection.md, A980 S2d): Marta, a cashier, voids
// three lines on table 4's bill with Void…, and a fourth line she removes before preparation started
// leaves no adjustment.

const DISHES = [
  { name: "Grilled squid", customer: "Squid from the griddle", kitchen: "SQUID", price: "12.35" },
  { name: "House red", customer: "Red wine of the house", kitchen: "RED", price: "4.85" },
  { name: "Chocolate cake", customer: "Dark chocolate cake", kitchen: "CAKE", price: "6.15" },
  { name: "Sparkling water", customer: "Fizzy mineral water", kitchen: "FIZZ", price: "2.35" },
  { name: "Lemon tart", customer: "Tart of Seville lemons", kitchen: "TART", price: "5.90" },
] as const;

const voidReason = (name: string): AdjustmentReasonInput => ({
  name,
  names: {},
  kind: "void",
  actions: ["cancel"],
  maxPercentBp: null,
  maxAmount: null,
  applyRoles: [],
  approverRoles: [],
  noteRequired: false,
});

interface Story {
  venue: AdjustmentVenue;
  marta: string;
  luis: string;
  ana: string;
  /** Table 4's order number, as `billWith` allocated it. */
  tableFourOrder: number;
  /** Line ids on table 4's bill, by dish. */
  lines: Map<string, string>;
  /** Each recorded cancel's `created_at`, by dish. */
  at: Map<string, string>;
}

let story: Story;

/** Marta's `adjustments.json`: the three line voids she made giving a reason, in time order. */
function martaAdjustments(s: Story) {
  return {
    counts: { cancel: 3, comp: 0, discount_percent: 0, discount_amount: 0 },
    entries: [
      {
        action: "cancel",
        at: s.at.get("Grilled squid"),
        order: s.tableFourOrder,
        item: "Grilled squid",
        quantity: "1.000",
        percent: null,
        takenOff: "12.35",
        listValue: "12.35",
        reason: "Sent to the wrong table",
        stage: "fired",
        chargeKept: false,
        preparationStarted: true,
        yourPart: ["requested"],
      },
      {
        action: "cancel",
        at: s.at.get("House red"),
        order: s.tableFourOrder,
        item: "House red",
        quantity: "1.000",
        percent: null,
        takenOff: "0.00",
        listValue: "4.85",
        reason: "Kitchen error",
        stage: "fired",
        chargeKept: true,
        preparationStarted: true,
        yourPart: ["requested"],
      },
      {
        action: "cancel",
        at: s.at.get("Chocolate cake"),
        order: s.tableFourOrder,
        item: "Chocolate cake",
        quantity: "1.000",
        percent: null,
        takenOff: "6.15",
        listValue: "6.15",
        reason: "Sent to the wrong table",
        stage: "fired",
        chargeKept: false,
        preparationStarted: true,
        yourPart: ["requested"],
      },
    ],
  };
}

async function linesOf(venue: AdjustmentVenue, billId: string): Promise<Map<string, string>> {
  const rows = await inTx(venue, (tx) =>
    tx
      .select({ id: workingOrderLines.id, name: workingOrderLines.name })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, billId)),
  );
  return new Map(rows.map((row) => [row.name, row.id]));
}

async function startPreparing(venue: AdjustmentVenue, lineId: string): Promise<void> {
  await inTx(venue, async (tx) => {
    const [ticket] = await tx
      .select({ id: ticketItems.id })
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderLineId, lineId));
    await advanceTicketItem(tx, venue.cfg, ticket!.id, "preparing");
  });
}

/** Cancels one of `lineId` through `cancelItem`, as the till's Cancel item dialog sends it, and
 * answers the `created_at` of the adjustment it recorded, if any. */
async function voidLine(
  venue: AdjustmentVenue,
  bill: { partyId: string; billId: string },
  lineId: string,
  operatorId: string,
  choice: Pick<CancelItemAsk, "outcome" | "reasonId" | "approver">,
): Promise<string | undefined> {
  await inTx(venue, async (tx) => {
    const [party] = await tx.select().from(parties).where(eq(parties.id, bill.partyId));
    const [order] = await tx.select().from(workingOrders).where(eq(workingOrders.id, bill.billId));
    const ask: CancelItemAsk = {
      quantity: "1",
      expectedEdit: await readBillEditState(tx, bill.billId),
      expectedPartyRevision: party!.revision,
      expectedBillRevision: order!.revision,
      expectedContext: await readCancellationContext(tx, bill.partyId, lineId),
      submissionId: randomUUID(),
      ...choice,
    };
    await cancelItem(tx, venue.cfg, bill.partyId, lineId, ask, operatorId);
  });
  // Two cancels in one millisecond would tie on `created_at` and be ordered by their random ids.
  await new Promise((resolve) => setTimeout(resolve, 2));
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ createdAt: adjustments.createdAt })
      .from(adjustments)
      .where(eq(adjustments.lineId, lineId)),
  );
  return row?.createdAt;
}

async function tellStory(venue: AdjustmentVenue): Promise<Story> {
  const { offers, ids, reasons, ana } = await inTx(venue, async (tx) => {
    await tx
      .update(persons)
      .set({ displayName: "Marta Ruiz" })
      .where(eq(persons.id, venue.staffId));
    await tx
      .update(persons)
      .set({ displayName: "Luis Vidal" })
      .where(eq(persons.id, venue.supervisorId));
    await tx
      .update(persons)
      .set({ displayName: "Pablo Gil" })
      .where(eq(persons.id, venue.managerId));
    const [added] = await tx
      .insert(persons)
      .values({ displayName: "Ana Soler", role: "staff" })
      .returning({ id: persons.id });
    const [carta] = await tx
      .select({ id: catalogues.id })
      .from(catalogues)
      .where(eq(catalogues.name, "Carta"));
    const [platos] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.name, "Platos"));
    const ids = new Map<string, string>();
    for (const dish of DISHES) {
      const product = await createProduct(tx, {
        catalogueId: carta!.id,
        categoryId: platos!.id,
        name: dish.name,
        customerName: { [venue.cfg.locale]: dish.customer },
        kitchenName: dish.kitchen,
        pricingUnit: "each",
        unitPrice: dish.price,
        vatClass: "general",
      });
      ids.set(dish.name, product.id);
    }
    const offers = await offerProducts(tx, venue.cfg, {
      zone: "tables",
      productIds: [...ids.values()],
    });
    const reasons = {
      wrongTable: (await createAdjustmentReason(tx, voidReason("Sent to the wrong table"))).id,
      kitchenError: (await createAdjustmentReason(tx, voidReason("Kitchen error"))).id,
      spilled: (await createAdjustmentReason(tx, voidReason("Spilled"))).id,
    };
    return { offers, ids, reasons, ana: added!.id };
  });
  const selling = { ...venue, item: (name: string) => offers.offerFor(ids.get(name)!) };
  const marta = venue.staffId;
  const luis = venue.supervisorId;
  const luisApproves = { personId: luis, pin: PINS.supervisor };

  const tableFour = await billWith(
    selling,
    [
      { name: "Grilled squid", quantity: "2" },
      { name: "House red" },
      { name: "Chocolate cake" },
      { name: "Sparkling water" },
    ],
    { operatorId: marta },
  );
  const [order] = await inTx(venue, (tx) =>
    tx
      .select({ orderNumber: workingOrders.orderNumber })
      .from(workingOrders)
      .where(eq(workingOrders.id, tableFour.billId)),
  );
  const lines = await linesOf(venue, tableFour.billId);
  const at = new Map<string, string>();
  for (const dish of ["Grilled squid", "House red", "Chocolate cake"])
    await startPreparing(venue, lines.get(dish)!);

  at.set(
    "Grilled squid",
    (await voidLine(venue, tableFour, lines.get("Grilled squid")!, marta, {
      outcome: "remove_charge",
      reasonId: reasons.wrongTable,
      approver: luisApproves,
    }))!,
  );
  at.set(
    "House red",
    (await voidLine(venue, tableFour, lines.get("House red")!, marta, {
      outcome: "keep_charge",
      reasonId: reasons.kitchenError,
    }))!,
  );
  at.set(
    "Chocolate cake",
    (await voidLine(venue, tableFour, lines.get("Chocolate cake")!, marta, {
      outcome: "remove_charge",
      reasonId: reasons.wrongTable,
      approver: luisApproves,
    }))!,
  );
  const removed = await voidLine(venue, tableFour, lines.get("Sparkling water")!, marta, {
    outcome: "remove_charge",
  });
  expect(removed).toBeUndefined();

  const anasBill = await billWith(selling, [{ name: "Lemon tart" }], { operatorId: ana });
  const tart = (await linesOf(venue, anasBill.billId)).get("Lemon tart")!;
  await startPreparing(venue, tart);
  at.set(
    "Lemon tart",
    (await voidLine(venue, anasBill, tart, ana, {
      outcome: "remove_charge",
      reasonId: reasons.spilled,
      approver: luisApproves,
    }))!,
  );

  return { venue, marta, luis, ana, tableFourOrder: order!.orderNumber, lines, at };
}

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    story = await tellStory(await provisionAdjustmentVenue(db));
  },
});

// As `sendPersonalData` does: prepare inside the snapshot turn, build outside it.
async function download(personId: string) {
  const { db, cfg } = story.venue;
  const build = await db.withWriteLock(() =>
    preparePersonalData(db, personalDataParts(modulesNamed(["core", "identity", "adjustments"])), {
      personId,
      language: "en",
      at: new Date(),
      timeZone: "UTC",
      locationId: cfg.locationId,
    }),
  );
  return build();
}

describe("the worked example's line voids in Marta's download", () => {
  it("lists her three voids made giving a reason, once each, and not the line she removed", async () => {
    const files = await download(story.marta);
    expect(files.map((f) => f.name)).toEqual(["profile.json", "sign-in.json", "adjustments.json"]);
    const times = ["Grilled squid", "House red", "Chocolate cake"].map((d) => story.at.get(d)!);
    expect(times[0]! < times[1]! && times[1]! < times[2]!).toBe(true);
    const file = files.find((f) => f.name === "adjustments.json")!;
    expect(JSON.parse(file.content as string)).toEqual(martaAdjustments(story));
  });

  it("records the kept-charge cancel's actor as the adjustment's requester, who is Marta", async () => {
    const lineId = story.lines.get("House red")!;
    const { cancellation, adjustment } = await inTx(story.venue, async (tx) => ({
      cancellation: await tx
        .select({ actorId: lineServiceCancellations.actorId })
        .from(lineServiceCancellations)
        .where(eq(lineServiceCancellations.lineId, lineId)),
      adjustment: await tx
        .select({ requestedBy: adjustments.requestedBy })
        .from(adjustments)
        .where(and(eq(adjustments.lineId, lineId), eq(adjustments.chargeKept, true))),
    }));
    expect(cancellation).toEqual([{ actorId: story.marta }]);
    expect(adjustment).toEqual([{ requestedBy: story.marta }]);
  });
});
