import { createException } from "@waitron/venue-service";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  drawerOpens,
  printJobs,
  printers,
  products,
  tills,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { createExtraList, createProduct, writeProductModifiers } from "@waitron/catalogue";
import { createPrinter } from "@waitron/printing";
import { listStationNotices, writePrintHeldWork } from "@waitron/venue-service";
import { applyAdjustment } from "./adjustments-apply.js";
import { placeGroups } from "./order-groups.js";
import { seatTable } from "./parties.js";
import { createTable } from "./tables.js";
import type { TillConfig } from "./till-config.js";
import { listStationQueue, updateHeldOrder } from "./working-order.js";
import { opensDrawer, printedLines } from "./testing/decode-ticket.js";
import {
  inTx,
  lineIdOf,
  provisionAdjustmentVenue,
  type AdjustmentVenue,
} from "./testing/adjustment-venue.js";
import { offerProducts } from "./testing/zone-offers.js";
import { createWatcher, setPrinterWatcher } from "./watchers.js";
import "./errors.js";

// Cancelling one extra of a dish the kitchen already has (B11g): the kitchen is told which extra to
// take off, and shown the dish as it now stands.
let venue: AdjustmentVenue;
/** The offers of the two dishes with extras: one the kitchen makes, one it never sees. */
let offer: { hamburger: string; toastie: string };
let extras: { listId: string; fries: string; salad: string; gherkins: string };

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionAdjustmentVenue(db);
    await inTx(venue, async (tx) => {
      const [burger] = await tx
        .select({ catalogueId: products.catalogueId, categoryId: products.categoryId })
        .from(products)
        .where(eq(products.name, "Burger"));
      const product = (name: string, customer: string, kitchen: string, price: string) =>
        createProduct(tx, {
          catalogueId: burger!.catalogueId,
          categoryId: burger!.categoryId!,
          name,
          customerName: { [venue.cfg.locale]: customer },
          kitchenName: kitchen,
          pricingUnit: "each",
          unitPrice: price,
          vatClass: "general",
        });
      // The dish's staff, customer-facing and kitchen names differ, so the slip can only pass by
      // printing the kitchen one.
      const hamburger = await product("Hamburger", "Hamburguesa completa", "HAMB", "14.00");
      const toastie = await product("Toastie", "Sándwich tostado", "TOST", "6.00");
      const fries = await product("Fries", "Patatas fritas", "PATATAS", "2.00");
      const gherkins = await product("Gherkins", "Pepinillos", "PEPIN", "0.50");
      const [salad] = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.name, "Salad"));
      const list = await createExtraList(
        tx,
        {
          name: "Sides",
          customerName: null,
          kitchenName: null,
          minPicks: 0,
          maxPicks: 4,
          active: true,
          items: [fries.id, salad!.id, gherkins.id].map((productId) => ({
            productId,
            maxQuantity: productId === gherkins.id ? 2 : 1,
            preselected: false,
            price: "1.00",
          })),
        },
        venue.cfg.locale,
      );
      for (const dish of [hamburger, toastie]) {
        await writeProductModifiers(tx, dish.id, [{ kind: "extras", id: list.id }]);
      }
      const offers = await offerProducts(tx, venue.cfg, {
        zone: "tables",
        productIds: [hamburger.id, toastie.id],
      });
      // Made at the bar with nothing to prepare: it never reaches a kitchen station.
      await createException(tx, venue.cfg, {
        zoneId: null,
        categoryId: null,
        productId: toastie.id,
        target: { kind: "no_preparation" },
      });
      offer = { hamburger: offers.offerFor(hamburger.id), toastie: offers.offerFor(toastie.id) };
      extras = { listId: list.id, fries: fries.id, salad: salad!.id, gherkins: gherkins.id };
    });
  },
});

const english: () => TillConfig = () => ({ ...venue.cfg, locale: "en-GB" });

/** How many of the dish, and how many gherkins each carries. */
interface Portions {
  dishes: string;
  gherkinsEach: number;
}

/** `dishes` of one dish with fries, salad and gherkins, as the till sends it. */
function withSides(menuItemId: string, { dishes, gherkinsEach }: Portions = ONE) {
  return {
    menuItemId,
    quantity: dishes,
    extras: [
      {
        listId: extras.listId,
        picks: [extras.fries, extras.salad, extras.gherkins].map((productId) => ({
          productId,
          quantity: productId === extras.gherkins ? gherkinsEach : 1,
        })),
      },
    ],
  };
}

const ONE: Portions = { dishes: "1", gherkinsEach: 1 };

/** A party at a fresh table with the dish on its bill, fired or held; answers the bill. */
async function billOf(
  dish: "hamburger" | "toastie",
  release: "fire" | "hold",
  portions: Portions = ONE,
): Promise<string> {
  return inTx(venue, async (tx) => {
    const table = await createTable(tx, venue.cfg, {
      label: `M-${randomUUID().slice(0, 8)}`,
      zoneId: venue.tables.zoneId,
    });
    const seated = await seatTable(tx, venue.cfg, {
      tableId: table.id,
      guestCount: null,
      operatorId: venue.staffId,
    });
    await placeGroups(tx, venue.cfg, seated.partyId, {
      groups: [{ lines: [withSides(offer[dish], portions)], release }],
      operatorId: venue.staffId,
      billId: seated.tabId,
    });
    return seated.tabId;
  });
}

async function revisionOf(tx: Transaction, billId: string): Promise<number> {
  const [order] = await tx
    .select({ revision: workingOrders.revision })
    .from(workingOrders)
    .where(eq(workingOrders.id, billId));
  return order!.revision;
}

type Command = Parameters<typeof applyAdjustment>[2];

/** Cancelling the gherkins, line 4 of the bill (the dish is 1, its extras 2 to 4 in the order picked). */
async function gherkinsCancel(billId: string): Promise<Command> {
  const lineId = await lineIdOf(venue, billId, 4);
  return inTx(venue, async (tx) => ({
    orderId: billId,
    submissionId: randomUUID(),
    expectedRevision: await revisionOf(tx, billId),
    lineId,
    action: "cancel" as const,
    reasonId: venue.reasonId.house,
    note: null,
    operatorId: venue.staffId,
  }));
}

function apply(tx: Transaction, command: Command, cfg: TillConfig = english()) {
  return applyAdjustment(tx, cfg, command, venue.venueLocale);
}

async function cancelGherkins(billId: string, cfg: TillConfig = english()): Promise<void> {
  const command = await gherkinsCancel(billId);
  await inTx(venue, (tx) => apply(tx, command, cfg));
}

async function jobs() {
  return inTx(venue, (tx) =>
    tx
      .select({ printerId: printJobs.printerId, kind: printJobs.kind, payload: printJobs.payload })
      .from(printJobs)
      .orderBy(sql`rowid`),
  );
}

/** The print jobs enqueued while `act` ran, as the lines each prints. */
async function jobsDuring(act: () => Promise<void>) {
  const before = (await jobs()).length;
  await act();
  return (await jobs()).slice(before).map((job) => ({
    printerId: job.printerId,
    kind: job.kind,
    lines: printedLines(job.payload).filter((line) => line.trim() !== ""),
  }));
}

async function notices() {
  return inTx(venue, (tx) => listStationNotices(tx, venue.cfg, venue.stationId));
}

/** The notices recorded while `act` ran. */
async function noticesDuring(act: () => Promise<void>) {
  const before = (await notices()).length;
  await act();
  return (await notices()).slice(before);
}

describe("cancelling an extra of a dish the kitchen has fired (B11g)", () => {
  it("sends EXTRA CANCELLED from the adjustment action to the dish's watcher", async () => {
    const printerId = await inTx(venue, async (tx) => {
      const watcher = await createWatcher(tx, venue.cfg, {
        name: `Extra ${randomUUID()}`,
        runsPass: false,
        everyStation: false,
        stationIds: [venue.stationId],
        everyZone: true,
        zoneIds: [],
      });
      const printer = await createPrinter(
        tx,
        { locationId: venue.cfg.locationId },
        {
          name: `Extra ${randomUUID()}`,
          transport: "cloud_poll",
          pollId: randomUUID(),
        },
      );
      await setPrinterWatcher(tx, venue.cfg, printer.id, watcher.id);
      return printer.id;
    });
    try {
      const billId = await billOf("hamburger", "fire");
      const before = (await jobs()).filter((job) => job.printerId === printerId).length;
      await cancelGherkins(billId);
      const added = (await jobs()).filter((job) => job.printerId === printerId).slice(before);
      expect(added).toHaveLength(1);
      expect(printedLines(added[0]!.payload).join(" ")).toContain("HAMB");
      expect(printedLines(added[0]!.payload).join(" ")).toContain("Gherkins");
      expect(printedLines(added[0]!.payload).join(" ")).toContain("CHANGED");
    } finally {
      await inTx(venue, (tx) => setPrinterWatcher(tx, venue.cfg, printerId, null));
    }
  });
  it("prints one CHANGED slip of the dish as it now stands, and the extra to take off", async () => {
    const billId = await billOf("hamburger", "fire");

    const printed = await jobsDuring(() => cancelGherkins(billId));

    expect(printed).toHaveLength(1);
    const [slip] = printed;
    expect(slip!.printerId).toBe(venue.printerId);
    expect(slip!.kind).toBe("document");
    expect(slip!.lines[0]).toBe("*** CHANGED ***");
    expect(slip!.lines).toContain("1.000 x HAMB");
    expect(slip!.lines).toContain("  + Fries");
    expect(slip!.lines).toContain("  + Salad");
    expect(slip!.lines).toContain("  CANCEL: Gherkins");
    expect(slip!.lines).not.toContain("  + Gherkins");
    const text = slip!.lines.join("\n");
    expect(text).not.toContain("Hamburger");
    expect(text).not.toContain("Hamburguesa completa");
    expect(text).not.toContain("GROUP");
  });

  it("records a changed notice on the dish naming the extra", async () => {
    const billId = await billOf("hamburger", "fire");

    const recorded = await noticesDuring(() => cancelGherkins(billId));

    expect(recorded).toEqual([
      expect.objectContaining({
        workingOrderId: billId,
        kind: "changed",
        lineName: "HAMB",
        quantity: "1.000",
        wasStarted: false,
        direction: null,
        cancelledExtra: "Gherkins",
      }),
    ]);
  });

  it("marks the notice started when the cook had started the dish", async () => {
    const billId = await billOf("hamburger", "fire");
    await inTx(venue, async (tx) => {
      await tx.run(sql`
        update ticket_items set state = 'preparing'
        where working_order_line_id = (select id from working_order_lines
          where working_order_id = ${billId} and line_no = 1)`);
    });

    const recorded = await noticesDuring(() => cancelGherkins(billId));

    expect(recorded).toEqual([
      expect.objectContaining({ wasStarted: true, cancelledExtra: "Gherkins" }),
    ]);
  });

  it("prints its words in Spanish for a server whose language is Spanish", async () => {
    const billId = await billOf("hamburger", "fire");

    const printed = await jobsDuring(() =>
      cancelGherkins(billId, { ...venue.cfg, locale: "es-ES" }),
    );

    expect(printed.map((job) => [job.lines[0], job.lines.at(-1)])).toEqual([
      ["*** CAMBIADO ***", "  QUITAR: Gherkins"],
    ]);
  });

  it("records the notice but prints nothing when the dish's station has no active printer", async () => {
    const billId = await billOf("hamburger", "fire");
    await inTx(venue, (tx) =>
      tx.update(printers).set({ active: false }).where(eq(printers.id, venue.printerId)),
    );
    try {
      let recorded: Awaited<ReturnType<typeof notices>> = [];
      const printed = await jobsDuring(async () => {
        recorded = await noticesDuring(() => cancelGherkins(billId));
      });

      expect(printed).toEqual([]);
      expect(recorded).toEqual([
        expect.objectContaining({ kind: "changed", cancelledExtra: "Gherkins" }),
      ]);
    } finally {
      await inTx(venue, (tx) =>
        tx.update(printers).set({ active: true }).where(eq(printers.id, venue.printerId)),
      );
    }
  });

  // Holds only while the station queue reads a dish's extras from the bill as it stands now.
  it("leaves the cancelled extra off the dish on the station's queue", async () => {
    const billId = await billOf("hamburger", "fire");
    const dishRow = async () => {
      const queue = await inTx(venue, (tx) => listStationQueue(tx, venue.stationId));
      const order = queue.find((group) => group.orderId === billId)!;
      return order.items[0]!.modifiers.map((modifier) => modifier.descriptions[venue.cfg.locale]);
    };
    expect(await dishRow()).toEqual(["Patatas fritas", "Ensalada de la casa", "Pepinillos"]);

    await cancelGherkins(billId);

    expect(await dishRow()).toEqual(["Patatas fritas", "Ensalada de la casa"]);
  });

  it("prints one slip and records one notice when the same cancel arrives twice", async () => {
    const billId = await billOf("hamburger", "fire");
    const command = await gherkinsCancel(billId);
    let recorded: Awaited<ReturnType<typeof notices>> = [];

    const printed = await jobsDuring(async () => {
      recorded = await noticesDuring(async () => {
        const first = await inTx(venue, (tx) => apply(tx, command));
        const replayed = await inTx(venue, (tx) => apply(tx, command));
        expect(replayed).toEqual(first);
      });
    });

    expect(printed).toHaveLength(1);
    expect(recorded).toHaveLength(1);
  });

  it("names how many of the extra each dish carried, and asks about every dish", async () => {
    const billId = await billOf("hamburger", "fire", { dishes: "2", gherkinsEach: 2 });
    let recorded: Awaited<ReturnType<typeof notices>> = [];

    const printed = await jobsDuring(async () => {
      recorded = await noticesDuring(() => cancelGherkins(billId));
    });

    expect(printed).toHaveLength(1);
    expect(printed[0]!.lines).toContain("2.000 x HAMB");
    expect(printed[0]!.lines).toContain("  CANCEL: Gherkins x2");
    expect(recorded).toEqual([
      expect.objectContaining({ quantity: "2.000", cancelledExtra: "Gherkins x2" }),
    ]);
  });

  it("asks about the dishes the kitchen was asked for, not every dish on the bill", async () => {
    const billId = await billOf("hamburger", "fire", { dishes: "3", gherkinsEach: 2 });
    // Set on the ticket item directly: the kitchen was asked for one of the three.
    await inTx(venue, async (tx) => {
      await tx.run(sql`
        update ticket_items set quantity = 1000
        where working_order_line_id = (select id from working_order_lines
          where working_order_id = ${billId} and line_no = 1)`);
    });
    let recorded: Awaited<ReturnType<typeof notices>> = [];

    const printed = await jobsDuring(async () => {
      recorded = await noticesDuring(() => cancelGherkins(billId));
    });

    expect(printed).toHaveLength(1);
    expect(printed[0]!.lines).toContain("1.000 x HAMB");
    expect(printed[0]!.lines).toContain("  CANCEL: Gherkins x2");
    expect(recorded).toEqual([
      expect.objectContaining({ quantity: "1.000", cancelledExtra: "Gherkins x2" }),
    ]);
  });

  it("leaves no slip and no notice when the cancel's transaction rolls back", async () => {
    const billId = await billOf("hamburger", "fire");
    const gherkinsId = await lineIdOf(venue, billId, 4);
    const command = await gherkinsCancel(billId);
    let recorded: Awaited<ReturnType<typeof notices>> = [];

    const printed = await jobsDuring(async () => {
      recorded = await noticesDuring(async () => {
        await expect(
          inTx(venue, async (tx) => {
            const jobsBefore = (await tx.select({ kind: printJobs.kind }).from(printJobs)).length;
            const noticesBefore = (await listStationNotices(tx, venue.cfg, venue.stationId)).length;
            await apply(tx, command);
            const written = (
              await tx
                .select({ kind: printJobs.kind, payload: printJobs.payload })
                .from(printJobs)
                .orderBy(sql`rowid`)
            ).slice(jobsBefore);
            expect(written).toHaveLength(1);
            expect(printedLines(written[0]!.payload)).toContain("  CANCEL: Gherkins");
            expect(
              (await listStationNotices(tx, venue.cfg, venue.stationId)).slice(noticesBefore),
            ).toEqual([expect.objectContaining({ cancelledExtra: "Gherkins" })]);
            throw new Error("a later step of the request fails");
          }),
        ).rejects.toThrow("a later step of the request fails");
      });
    });

    expect(printed).toEqual([]);
    expect(recorded).toEqual([]);
    const [gherkins] = await inTx(venue, (tx) =>
      tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.id, gherkinsId)),
    );
    expect(gherkins).toBeDefined();
  });

  it("never opens a cash drawer, even when the till's receipt printer has one", async () => {
    const billId = await billOf("hamburger", "fire");
    const [till] = await inTx(venue, (tx) =>
      tx
        .select({ receiptPrinterId: tills.receiptPrinterId })
        .from(tills)
        .where(eq(tills.id, venue.cfg.tillId)),
    );
    // The kitchen's printer is also the till's receipt printer, with a drawer attached.
    await inTx(venue, async (tx) => {
      await tx
        .update(tills)
        .set({ receiptPrinterId: venue.printerId })
        .where(eq(tills.id, venue.cfg.tillId));
      await tx
        .update(printers)
        .set({ hasCashDrawer: true })
        .where(eq(printers.id, venue.printerId));
    });
    try {
      const drawerOpensBefore = (await inTx(venue, (tx) => tx.select().from(drawerOpens))).length;
      const before = (await jobs()).length;

      await cancelGherkins(billId, { ...english(), allowCashDrawer: true });

      const enqueued = (await jobs()).slice(before);
      expect(enqueued.map((job) => job.kind)).toEqual(["document"]);
      expect(enqueued.some((job) => opensDrawer(new Uint8Array(job.payload)))).toBe(false);
      expect((await inTx(venue, (tx) => tx.select().from(drawerOpens))).length).toBe(
        drawerOpensBefore,
      );
    } finally {
      await inTx(venue, async (tx) => {
        await tx
          .update(tills)
          .set({ receiptPrinterId: till!.receiptPrinterId })
          .where(eq(tills.id, venue.cfg.tillId));
        await tx
          .update(printers)
          .set({ hasCashDrawer: false })
          .where(eq(printers.id, venue.printerId));
      });
    }
  });
});

describe("cancelling an extra of a held dish (B11g)", () => {
  it("prints a HOLD CHANGED slip naming the group when the group's HOLD ticket was queued", async () => {
    await inTx(venue, (tx) => writePrintHeldWork(tx, true));
    try {
      const billId = await billOf("hamburger", "hold");
      let recorded: Awaited<ReturnType<typeof notices>> = [];

      const printed = await jobsDuring(async () => {
        recorded = await noticesDuring(() => cancelGherkins(billId));
      });

      expect(printed).toHaveLength(1);
      const lines = printed[0]!.lines;
      expect(lines[0]).toBe("*** HOLD CHANGED ***");
      expect(lines).toContain("GROUP 1");
      expect(lines.slice(lines.indexOf("1.000 x HAMB"))).toEqual([
        "1.000 x HAMB",
        "  + Fries",
        "  + Salad",
        "  CANCEL: Gherkins",
      ]);
      expect(recorded).toEqual([
        expect.objectContaining({
          kind: "changed",
          lineName: "HAMB",
          quantity: "1.000",
          direction: null,
          cancelledExtra: "Gherkins",
        }),
      ]);
    } finally {
      await inTx(venue, (tx) => writePrintHeldWork(tx, false));
    }
  });

  it("tells the kitchen nothing when the group's HOLD ticket was never queued", async () => {
    const billId = await billOf("hamburger", "hold");
    let recorded: Awaited<ReturnType<typeof notices>> = [];

    const printed = await jobsDuring(async () => {
      recorded = await noticesDuring(() => cancelGherkins(billId));
    });

    expect(printed).toEqual([]);
    expect(recorded).toEqual([]);
  });
});

describe("cancelling an extra of a dish the kitchen does not have (B11g)", () => {
  it("tells the kitchen nothing for a dish never sent", async () => {
    const seated = await inTx(venue, async (tx) => {
      const table = await createTable(tx, venue.cfg, {
        label: `M-${randomUUID().slice(0, 8)}`,
        zoneId: venue.tables.zoneId,
      });
      return seatTable(tx, venue.cfg, {
        tableId: table.id,
        guestCount: null,
        operatorId: venue.staffId,
      });
    });
    const billId = seated.tabId;
    await updateHeldOrder({ db: venue.db }, venue.cfg, billId, {
      revision: await inTx(venue, (tx) => revisionOf(tx, billId)),
      lines: [withSides(offer.hamburger)],
      operatorId: venue.staffId,
    });
    let recorded: Awaited<ReturnType<typeof notices>> = [];

    const printed = await jobsDuring(async () => {
      recorded = await noticesDuring(() => cancelGherkins(billId));
    });

    expect(printed).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it("tells the kitchen nothing for a dish that goes to no station", async () => {
    const billId = await billOf("toastie", "fire");
    let recorded: Awaited<ReturnType<typeof notices>> = [];

    const printed = await jobsDuring(async () => {
      recorded = await noticesDuring(() => cancelGherkins(billId));
    });

    expect(printed).toEqual([]);
    expect(recorded).toEqual([]);
  });
});
