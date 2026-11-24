import { addGroupedTabRound, addTabRound } from "./testing/order-writer-fixture.js";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { diningTables, ticketItems, workingOrderLines } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { createProduct, units } from "@waitron/menu";
import { thousandthsToDecimal } from "@waitron/shared";
import type { OriginConfig } from "./trading-context.js";
import { createStation, updateStation } from "./kitchen.js";
import { listStationQueue } from "./working-order-station-queue.js";
import { listStationNotices } from "@waitron/venue-service";
import { setStationPrinting } from "./testing/station-printing.js";
import {
  enqueueAllergyCorrectionSlips,
  enqueueCorrectionSlips,
  enqueueHoldCorrections,
  type CorrectionItem,
} from "./kitchen-ticket-corrections.js";
import { printedLines } from "./testing/decode-ticket.js";
import { routeProductTo, offerProducts } from "./testing/zone-offers.js";
import "./errors.js";
import { setupVenue, addExtras, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { openPartyTab } from "./testing/serve-line.js";
import { addPortionRound } from "./testing/portion-bill.js";
import type { KitchenAllergyBlock } from "@waitron/module";
import {
  bindKitchenPrintDb,
  useKitchenPrintDb,
  db,
  asApp,
  printJobsFor,
  makeProduct,
  makeSharedPrinter,
} from "./testing/kitchen-print.test-support.js";

const suite = useKitchenPrintDb();
beforeAll(() => {
  bindKitchenPrintDb(suite.db);
  useSplitExtrasDb(db);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterEach(async () => {
  await suite.db.execute(sql`delete from print_jobs`);
});

describe("A803 portion grouping", () => {
  /** Kitchen (with a printer, showing the rest of the order) and Fryer (with its own printer); a
   * Burger with a Cheese extra of up to two and Oysters at Kitchen, Chips and Octopus (sold by
   * weight) at Fryer; and a party's open bill at a fresh table. */
  async function portionKitchen(tx: Transaction, cfg: OriginConfig) {
    const kitchen = await createStation(tx, { name: "Kitchen", isDefault: true });
    const fryer = await createStation(tx, { name: "Fryer" });
    await updateStation(tx, kitchen.id, { showsRestOfOrder: true });
    const kitchenPrinter = await makeSharedPrinter(tx, "Kitchen printer", [kitchen.id]);
    const fryerPrinter = await makeSharedPrinter(tx, "Fryer printer", [fryer.id]);
    const burger = await makeProduct(tx, "Burger", { stationId: kitchen.id });
    const oysters = await makeProduct(tx, "Oysters", { stationId: kitchen.id });
    const chips = await makeProduct(tx, "Chips", { stationId: fryer.id });
    const { id: octopus } = await createProduct(tx, {
      categoryId: null,
      name: "Octopus",
      pricingUnit: "weight",
      unitPrice: "20.00",
      vatClass: "general",
    });
    await routeProductTo(tx, octopus, fryer.id);
    const { listId, productIds } = await addExtras(tx, cfg, burger, [
      { name: "Cheese", customerName: "Mature cheddar", kitchenName: "CHED", maxQuantity: 2 },
    ]);
    const offers = await offerProducts(tx, { zone: "tables" });
    const [table] = await tx
      .insert(diningTables)
      .values({ label: "P1", zoneId: offers.zoneId })
      .returning({ id: diningTables.id });
    await tx.update(diningTables).set({ onFloor: true }).where(eq(diningTables.id, table!.id));
    const { tabId } = await openPartyTab(tx, cfg, { tableId: table!.id });
    const cheese = (count: number) => [
      { listId, picks: [{ productId: productIds[0]!, quantity: count }] },
    ];
    return {
      kitchen: kitchen.id,
      fryer: fryer.id,
      kitchenPrinter,
      fryerPrinter,
      tabId,
      offer: offers.offerFor,
      ids: { burger, oysters, chips, octopus, cheese: productIds[0]! },
      cheese,
    };
  }

  /** The order's fired dish lines at `stationId`, in line order, as correction items of one. */
  async function firedAt(tx: Transaction, orderId: string, stationId: string) {
    const rows = await tx
      .select({
        workingOrderLineId: ticketItems.workingOrderLineId,
        stationId: ticketItems.stationId,
        lineNo: workingOrderLines.lineNo,
      })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .where(
        and(eq(workingOrderLines.workingOrderId, orderId), eq(ticketItems.stationId, stationId)),
      );
    return rows
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((row) => ({
        workingOrderLineId: row.workingOrderLineId,
        stationId: row.stationId!,
        quantity: 1000,
        wasStarted: false,
      }));
  }

  /** Print jobs queued by `fn`, in queue order. */
  async function jobsDuring(tx: Transaction, fn: () => Promise<unknown>) {
    const before = new Set((await printJobsFor(tx)).map((job) => job.id));
    await fn();
    return (await printJobsFor(tx)).filter((job) => !before.has(job.id));
  }

  const count = (lines: string[], text: string) => lines.filter((line) => line === text).length;

  it("A803 portion grouping: two identical portions print 2 x Burger combined and two 1 x Burger separate, as one grouped line does", async () => {
    const { cfg } = await setupVenue();
    const printed = await asApp(async (tx) => {
      const k = await portionKitchen(tx, cfg);
      const burgers = [{ menuItemId: k.offer(k.ids.burger), quantity: "2" }];
      const portions = await jobsDuring(tx, () =>
        addPortionRound(tx, cfg, k.tabId, burgers, { fire: true }),
      );
      const grouped = await jobsDuring(tx, async () => {
        await addTabRound(tx, cfg, k.tabId, burgers);
      });
      await setStationPrinting(tx, { ticketGrouping: "separate" }, [k.kitchen]);
      const separate = await jobsDuring(tx, () =>
        addPortionRound(tx, cfg, k.tabId, burgers, { fire: true }),
      );
      return { portions, grouped, separate };
    });

    const linesOf = (jobs: { payload: Uint8Array }[]) => {
      expect(jobs).toHaveLength(1);
      return printedLines(jobs[0]!.payload);
    };
    const two = `2 x Burger`;
    const one = `1 x Burger`;
    expect(count(linesOf(printed.portions), two)).toBe(1);
    expect(count(linesOf(printed.portions), one)).toBe(0);
    expect(count(linesOf(printed.grouped), two)).toBe(1);
    expect(count(linesOf(printed.separate), one)).toBe(2);
    expect(count(linesOf(printed.separate), two)).toBe(0);
  });

  it("A803 portion grouping: portions differing in extras, extra count or note print apart, and a portion's extra badge reads its own count", async () => {
    const { cfg } = await setupVenue();
    const jobs = await asApp(async (tx) => {
      const k = await portionKitchen(tx, cfg);
      const burger = k.offer(k.ids.burger);
      return jobsDuring(tx, () =>
        addPortionRound(
          tx,
          cfg,
          k.tabId,
          [
            { menuItemId: burger, quantity: "2", extras: k.cheese(2) },
            { menuItemId: burger, quantity: "1", extras: k.cheese(1) },
            { menuItemId: burger, quantity: "1", note: "No onion" },
            { menuItemId: burger, quantity: "1" },
          ],
          { fire: true },
        ),
      );
    });

    expect(jobs).toHaveLength(1);
    const lines = printedLines(jobs[0]!.payload);
    const two = `2 x Burger`;
    const one = `1 x Burger`;
    expect(count(lines, two)).toBe(1);
    expect(count(lines, one)).toBe(3);
    expect(lines[lines.indexOf(two) + 1]).toMatch(/^\s*\+ CHED x2$/u);
    expect(lines.filter((line) => /\+ CHED$/u.test(line))).toHaveLength(1);
    expect(lines.filter((line) => /\* No onion$/u.test(line))).toHaveLength(1);
  });

  it("A803 portion grouping: the station queue gives each portion's extra its own count", async () => {
    const { cfg } = await setupVenue();
    const items = await asApp(async (tx) => {
      const k = await portionKitchen(tx, cfg);
      const burger = k.offer(k.ids.burger);
      await addPortionRound(
        tx,
        cfg,
        k.tabId,
        [
          { menuItemId: burger, quantity: "1", extras: k.cheese(1) },
          { menuItemId: burger, quantity: "1", extras: k.cheese(2) },
        ],
        { fire: true },
      );
      const queue = await listStationQueue(tx, k.kitchen);
      return queue.filter((group) => group.orderId === k.tabId).flatMap((group) => group.items);
    });

    expect(items.map((item) => item.modifiers.map((modifier) => modifier.perDish))).toEqual([
      [1],
      [2],
    ]);
  });

  it("A803 portion grouping: measured portions never merge, on the ticket, in Also on order or on a slip", async () => {
    const { cfg } = await setupVenue();
    const printed = await asApp(async (tx) => {
      const k = await portionKitchen(tx, cfg);
      const octopus = { menuItemId: k.offer(k.ids.octopus), quantity: "1" };
      const ticket = await jobsDuring(tx, () =>
        addPortionRound(tx, cfg, k.tabId, [octopus, octopus], { fire: true }),
      );
      const rest = await jobsDuring(tx, () =>
        addPortionRound(tx, cfg, k.tabId, [{ menuItemId: k.offer(k.ids.burger), quantity: "1" }], {
          fire: true,
        }),
      );
      const fired = await firedAt(tx, k.tabId, k.fryer);
      const slips = await jobsDuring(tx, () =>
        enqueueCorrectionSlips(tx, cfg, k.tabId, fired, "RECALLED"),
      );
      return {
        fired: fired.length,
        ticket: ticket.filter((job) => job.printerId === k.fryerPrinter),
        rest: rest.filter((job) => job.printerId === k.kitchenPrinter),
        slips,
      };
    });

    const octopus = `1 kg x Octopus`;
    expect(printed.ticket).toHaveLength(1);
    expect(count(printedLines(printed.ticket[0]!.payload), octopus)).toBe(2);
    expect(printed.rest).toHaveLength(1);
    expect(count(printedLines(printed.rest[0]!.payload), `${octopus} — Fryer`)).toBe(2);
    expect(printed.fired).toBe(2);
    expect(printed.slips).toHaveLength(2);
  });

  it("A803 portion grouping: Also on order lists identical portions once with their sum", async () => {
    const { cfg } = await setupVenue();
    const kitchenTicket = await asApp(async (tx) => {
      const k = await portionKitchen(tx, cfg);
      await addPortionRound(
        tx,
        cfg,
        k.tabId,
        [{ menuItemId: k.offer(k.ids.chips), quantity: "2" }],
        { fire: true },
      );
      const jobs = await jobsDuring(tx, () =>
        addPortionRound(tx, cfg, k.tabId, [{ menuItemId: k.offer(k.ids.burger), quantity: "1" }], {
          fire: true,
        }),
      );
      return jobs.filter((job) => job.printerId === k.kitchenPrinter);
    });

    expect(kitchenTicket).toHaveLength(1);
    const lines = printedLines(kitchenTicket[0]!.payload);
    expect(count(lines, `2 x Chips — Fryer`)).toBe(1);
    expect(count(lines, `1 x Chips — Fryer`)).toBe(0);
  });

  it("A803 portion grouping: Also on order keeps identical unbound lines apart, as today", async () => {
    const { cfg } = await setupVenue();
    const kitchenTicket = await asApp(async (tx) => {
      const k = await portionKitchen(tx, cfg);
      const chips = { menuItemId: k.offer(k.ids.chips), quantity: "1" };
      await addGroupedTabRound(tx, cfg, k.tabId, [chips]);
      await addGroupedTabRound(tx, cfg, k.tabId, [chips]);
      const jobs = await jobsDuring(tx, () =>
        addPortionRound(tx, cfg, k.tabId, [{ menuItemId: k.offer(k.ids.burger), quantity: "1" }], {
          fire: true,
        }),
      );
      return jobs.filter((job) => job.printerId === k.kitchenPrinter);
    });

    expect(kitchenTicket).toHaveLength(1);
    const lines = printedLines(kitchenTicket[0]!.payload);
    expect(count(lines, `1 x Chips — Fryer`)).toBe(2);
  });

  it("A803 portion grouping: Also on order keeps a held portion apart from a fired one, and a portion with a printed unit on its own row", async () => {
    const { cfg } = await setupVenue();
    const kitchenTicket = await asApp(async (tx) => {
      const k = await portionKitchen(tx, cfg);
      const [piece] = await tx
        .insert(units)
        .values({
          staffName: "Piece",
          staffAbbreviation: "pc",
          name: { en: "piece", es: "piece" },
          abbreviation: { en: "pc", es: "pc" },
          precision: 0,
          hardwareUnit: null,
        })
        .returning({ id: units.id });
      const { id: bread } = await createProduct(tx, {
        categoryId: null,
        name: "Bread",
        unitId: piece!.id,
        unitPrice: "1.50",
        vatClass: "general",
      });
      await routeProductTo(tx, bread, k.fryer);
      const offers = await offerProducts(tx, { zone: "tables" });
      await addPortionRound(
        tx,
        cfg,
        k.tabId,
        [
          { menuItemId: k.offer(k.ids.chips), quantity: "2" },
          { menuItemId: offers.offerFor(bread), quantity: "2" },
        ],
        { fire: true },
      );
      const [firstChips] = await firedAt(tx, k.tabId, k.fryer);
      await tx
        .update(ticketItems)
        .set({ firedAt: null })
        .where(eq(ticketItems.workingOrderLineId, firstChips!.workingOrderLineId));
      const jobs = await jobsDuring(tx, () =>
        addPortionRound(tx, cfg, k.tabId, [{ menuItemId: k.offer(k.ids.burger), quantity: "1" }], {
          fire: true,
        }),
      );
      return jobs.filter((job) => job.printerId === k.kitchenPrinter);
    });

    expect(kitchenTicket).toHaveLength(1);
    const lines = printedLines(kitchenTicket[0]!.payload);
    const oneChips = `1 x Chips — Fryer`;
    expect(count(lines, oneChips)).toBe(1);
    expect(lines.filter((line) => line.startsWith(oneChips) && line !== oneChips)).toHaveLength(1);
    expect(lines.filter((line) => line.includes(" x Chips"))).toHaveLength(2);
    expect(count(lines, `1 pc x Bread — Fryer`)).toBe(2);
  });

  it("A803 portion grouping: identical portions corrected at two stations print a slip at each", async () => {
    const { cfg } = await setupVenue();
    const { slips, printers } = await asApp(async (tx) => {
      const k = await portionKitchen(tx, cfg);
      await addPortionRound(
        tx,
        cfg,
        k.tabId,
        [{ menuItemId: k.offer(k.ids.burger), quantity: "2" }],
        { fire: true },
      );
      const [first, second] = await firedAt(tx, k.tabId, k.kitchen);
      const slips = await jobsDuring(tx, () =>
        enqueueCorrectionSlips(
          tx,
          cfg,
          k.tabId,
          [first!, { ...second!, stationId: k.fryer }],
          "RECALLED",
        ),
      );
      return { slips, printers: [k.kitchenPrinter, k.fryerPrinter] };
    });

    expect(slips.map((slip) => slip.printerId).sort()).toEqual([...printers].sort());
    for (const slip of slips) expect(count(printedLines(slip.payload), `1 x Burger`)).toBe(1);
  });

  it.each(["VOID", "RECALLED"] as const)(
    "A803 portion grouping: a %s of two identical portions records one notice of 2; unbound lines keep a notice each",
    async (kind) => {
      const { cfg } = await setupVenue();
      const shown = await asApp(async (tx) => {
        const k = await portionKitchen(tx, cfg);
        const burger = k.offer(k.ids.burger);
        await addPortionRound(tx, cfg, k.tabId, [{ menuItemId: burger, quantity: "2" }], {
          fire: true,
        });
        await enqueueCorrectionSlips(tx, cfg, k.tabId, await firedAt(tx, k.tabId, k.kitchen), kind);
        const portions = await listStationNotices(tx, k.kitchen);
        const chips = { menuItemId: k.offer(k.ids.chips), quantity: "1" };
        await addGroupedTabRound(tx, cfg, k.tabId, [chips]);
        await addGroupedTabRound(tx, cfg, k.tabId, [chips]);
        const unbound = await firedAt(tx, k.tabId, k.fryer);
        expect(unbound).toHaveLength(2);
        await enqueueCorrectionSlips(tx, cfg, k.tabId, unbound, kind);
        return {
          portions: portions.map(({ quantity }) => quantity),
          unbound: (await listStationNotices(tx, k.fryer)).map(({ quantity }) => quantity),
        };
      });

      expect(shown.portions).toEqual([thousandthsToDecimal(2000)]);
      expect(shown.unbound).toEqual([thousandthsToDecimal(1000), thousandthsToDecimal(1000)]);
    },
  );

  it("A803 portion grouping: notices keep portions apart at two stations, with different notes, or started apart", async () => {
    const { cfg } = await setupVenue();
    const added = await asApp(async (tx) => {
      const k = await portionKitchen(tx, cfg);
      const burger = k.offer(k.ids.burger);
      await addPortionRound(
        tx,
        cfg,
        k.tabId,
        [
          { menuItemId: burger, quantity: "2" },
          { menuItemId: burger, quantity: "1", note: "No onion" },
        ],
        { fire: true },
      );
      const [first, second, noted] = await firedAt(tx, k.tabId, k.kitchen);
      const noticesAt = async (stationId: string) =>
        (await listStationNotices(tx, stationId)).length;
      const during = async (items: CorrectionItem[]) => {
        const before = [await noticesAt(k.kitchen), await noticesAt(k.fryer)];
        await enqueueCorrectionSlips(tx, cfg, k.tabId, items, "RECALLED");
        return [(await noticesAt(k.kitchen)) - before[0]!, (await noticesAt(k.fryer)) - before[1]!];
      };
      return {
        stations: await during([first!, { ...second!, stationId: k.fryer }]),
        notes: await during([first!, noted!]),
        started: await during([first!, { ...second!, wasStarted: true }]),
        same: await during([first!, second!]),
        mixed: await (async () => {
          const burger = { menuItemId: k.offer(k.ids.burger), quantity: "1" };
          await addGroupedTabRound(tx, cfg, k.tabId, [burger]);
          await addGroupedTabRound(tx, cfg, k.tabId, [burger]);
          const unbound = (await firedAt(tx, k.tabId, k.kitchen)).slice(3);
          expect(unbound).toHaveLength(2);
          return during([first!, second!, ...unbound]);
        })(),
      };
    });

    expect(added).toEqual({
      stations: [1, 1],
      notes: [2, 0],
      started: [2, 0],
      same: [1, 0],
      mixed: [3, 0],
    });
  });

  it("A803 portion grouping: a void of two portions whose extra is made elsewhere tells that station the extras' whole count", async () => {
    const { cfg } = await setupVenue();
    const fryer = await asApp(async (tx) => {
      const k = await portionKitchen(tx, cfg);
      await routeProductTo(tx, k.ids.cheese, k.fryer);
      await addPortionRound(
        tx,
        cfg,
        k.tabId,
        [{ menuItemId: k.offer(k.ids.burger), quantity: "2", extras: k.cheese(2) }],
        { fire: true },
      );
      const extras = await firedAt(tx, k.tabId, k.fryer);
      expect(extras).toHaveLength(2);
      const items = await tx
        .select({ lineId: ticketItems.workingOrderLineId, quantity: workingOrderLines.quantity })
        .from(ticketItems)
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
        .where(eq(ticketItems.stationId, k.fryer));
      await enqueueCorrectionSlips(
        tx,
        cfg,
        k.tabId,
        extras.map((item) => ({
          ...item,
          quantity: items.find((row) => row.lineId === item.workingOrderLineId)!.quantity,
        })),
        "VOID",
      );
      return (await listStationNotices(tx, k.fryer)).map(({ quantity }) => quantity);
    });

    expect(fryer).toEqual([thousandthsToDecimal(4000)]);
  });

  it("A803 portion grouping: notices keep identical portions of two held courses apart", async () => {
    const { cfg } = await setupVenue();
    const added = await asApp(async (tx) => {
      const k = await portionKitchen(tx, cfg);
      await addPortionRound(
        tx,
        cfg,
        k.tabId,
        [{ menuItemId: k.offer(k.ids.burger), quantity: "2" }],
        { fire: true },
      );
      const [first, second] = await firedAt(tx, k.tabId, k.kitchen);
      await enqueueHoldCorrections(
        tx,
        cfg,
        k.tabId,
        [
          { ...first!, group: 1 },
          { ...second!, group: 2 },
        ],
        { kind: "HOLD CANCELLED" },
      );
      return (await listStationNotices(tx, k.kitchen)).length;
    });

    expect(added).toBe(2);
  });

  it("A803 portion grouping: a correction keeps identical unbound lines on their own slips, as today", async () => {
    const { cfg } = await setupVenue();
    const slips = await asApp(async (tx) => {
      const k = await portionKitchen(tx, cfg);
      const burger = { menuItemId: k.offer(k.ids.burger), quantity: "1" };
      await addGroupedTabRound(tx, cfg, k.tabId, [burger]);
      await addGroupedTabRound(tx, cfg, k.tabId, [burger]);
      const fired = await firedAt(tx, k.tabId, k.kitchen);
      expect(fired).toHaveLength(2);
      return jobsDuring(tx, () => enqueueCorrectionSlips(tx, cfg, k.tabId, fired, "RECALLED"));
    });

    expect(slips).toHaveLength(2);
  });

  it.each(["combined", "separate"] as const)(
    "A803 portion grouping: a held round of 12 oysters changed or cancelled prints one HOLD CHANGED / HOLD CANCELLED slip of 12 per station (%s)",
    async (grouping) => {
      const { cfg } = await setupVenue();
      const printed = await asApp(async (tx) => {
        const k = await portionKitchen(tx, cfg);
        await setStationPrinting(tx, { ticketGrouping: grouping }, [k.kitchen]);
        await addPortionRound(
          tx,
          cfg,
          k.tabId,
          [{ menuItemId: k.offer(k.ids.oysters), quantity: "12" }],
          { fire: true },
        );
        const oysters = (await firedAt(tx, k.tabId, k.kitchen)).map((item) => ({
          ...item,
          group: 1,
        }));
        const changed = await jobsDuring(tx, () =>
          enqueueHoldCorrections(tx, cfg, k.tabId, oysters, {
            kind: "HOLD CHANGED",
            direction: "removed",
          }),
        );
        const cancelled = await jobsDuring(tx, () =>
          enqueueHoldCorrections(tx, cfg, k.tabId, oysters, { kind: "HOLD CANCELLED" }),
        );
        const notices = await listStationNotices(tx, k.kitchen);
        return { count: oysters.length, changed, cancelled, notices };
      });

      expect(printed.count).toBe(12);
      expect(
        printed.notices.map(({ kind, direction, quantity }) => ({ kind, direction, quantity })),
      ).toEqual(
        expect.arrayContaining([
          { kind: "changed", direction: "removed", quantity: thousandthsToDecimal(12_000) },
          { kind: "void", direction: null, quantity: thousandthsToDecimal(12_000) },
        ]),
      );
      expect(printed.notices).toHaveLength(2);
      for (const slips of [printed.changed, printed.cancelled]) {
        expect(slips).toHaveLength(1);
        const lines = printedLines(slips[0]!.payload);
        expect(lines.filter((line) => line.endsWith(`12 x Oysters`))).toHaveLength(1);
      }
    },
  );

  it("A803 portion grouping: an allergy change on two identical portions prints one slip; different allergy blocks print separate slips", async () => {
    const block = (who: string): KitchenAllergyBlock => ({
      who,
      allergens: { milk: {} },
      note: null,
      clashes: {},
      labels: { en: { avoids: ["Milk"], clashes: [] }, es: { avoids: ["Milk"], clashes: [] } },
    });
    const { cfg } = await setupVenue();
    const printed = await asApp(async (tx) => {
      const k = await portionKitchen(tx, cfg);
      await addPortionRound(
        tx,
        cfg,
        k.tabId,
        [{ menuItemId: k.offer(k.ids.burger), quantity: "2" }],
        { fire: true },
      );
      const burgers = await firedAt(tx, k.tabId, k.kitchen);
      const same = await jobsDuring(tx, () =>
        enqueueAllergyCorrectionSlips(
          tx,
          cfg,
          k.tabId,
          burgers.map((item) => ({ ...item, allergyBlock: block("Guest 1") })),
        ),
      );
      const different = await jobsDuring(tx, () =>
        enqueueAllergyCorrectionSlips(
          tx,
          cfg,
          k.tabId,
          burgers.map((item, i) => ({ ...item, allergyBlock: block(`Guest ${i + 1}`) })),
        ),
      );
      return { same, different };
    });

    expect(printed.same).toHaveLength(1);
    expect(count(printedLines(printed.same[0]!.payload), `2 x Burger`)).toBe(1);
    expect(printed.different).toHaveLength(2);
  });
});
