import { seedActivityActor } from "@waitron/db/testing/seed.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ticketItems, workingOrderLines, workingOrders } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { assignProductUnit, units, writeContentLanguages } from "@waitron/menu";
import { thousandthsToDecimal } from "@waitron/shared";
import type { OriginConfig } from "./trading-context.js";
import { createStation } from "./kitchen.js";
import { readPassRows } from "./working-order-pass.js";
import {
  listStationQueue,
  type QueueCrossRef,
  type QueueModifier,
} from "./working-order-station-queue.js";
import { createOpenOrder } from "./working-order-open.js";
import { fireLines } from "./working-order-kitchen-fire.js";
import { setStationToday } from "@waitron/venue-service";
import { setStationPrinting } from "./testing/station-printing.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { attachPrinterToStation } from "./station-printers.js";
import { reprintOrderTickets } from "./kitchen-ticket-reprint.js";
import { enqueueCorrectionSlips, readCancelledExtra } from "./kitchen-ticket-corrections.js";
import { extraLabel } from "./kitchen-ticket-items.js";
import { decodeTicket, printedLines } from "./testing/decode-ticket.js";
import { routeProductTo, offerProducts } from "./testing/zone-offers.js";
import "./errors.js";
import {
  setupVenue,
  fireNewOrder,
  fireGroupedOrder,
  addExtras,
  useSplitExtrasDb,
  setupSplitExtrasVenue,
} from "./testing/split-extras-venue.js";
import { readLinesSoldInEach } from "@waitron/venue-service";
import {
  bindKitchenPrintDb,
  useKitchenPrintDb,
  db,
  OPERATOR,
  LOCALE,
  asApp,
  printJobsFor,
  makeProduct,
  makePrinter,
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

it.each<[number, string, string, string]>([
  [2000, "g", "en", "Mint 2 g"],
  [200_000, "g", "en", "Mint 200 g"],
  [1500, "kg", "en", "Mint 1.500 kg"],
  [2000, "g", "es", "Mint 2 g"],
  [1500, "kg", "es", "Mint 1,500 kg"],
  [150, "kg", "es-ES", "Mint 0,150 kg"],
  [150, "kg", "en-GB", "Mint 0.150 kg"],
])(
  "prints a measured extra's %s thousandths in %s without whole-number decimals",
  (quantity, unit, locale, expected) => {
    expect(
      extraLabel("Mint", thousandthsToDecimal(quantity), thousandthsToDecimal(1000), locale, unit),
    ).toBe(expected);
  },
);

/**
 * Open an order with NO service context holding one dish line and one child line per pick, then FIRE
 * it, so the dish's product cell for Every zone selects its station. The lines are written straight to the table
 * because pricing one needs a zone; the price and name columns are placeholders nothing here reads.
 */
async function fireContextlessDish(
  tx: Transaction,
  cfg: OriginConfig,
  dishId: string,
  pickIds: string[],
): Promise<string> {
  const id = randomUUID();
  const offers = await offerProducts(tx);
  await createOpenOrder(tx, cfg, id, [], null, { zoneId: offers.zoneId });
  await tx.run(
    sql`update working_orders set zone_id = null, department_id = null, service_mode = null where id = ${id}`,
  );
  const placeholder = {
    workingOrderId: id,
    name: "Line",
    descriptions: { [LOCALE]: "Line" },
    quantity: 1000,
    unitPriceGross: 150,
    lineTotal: 150,
  };
  const [parent] = await tx
    .insert(workingOrderLines)
    .values({ ...placeholder, lineNo: 1, productId: dishId })
    .returning({ id: workingOrderLines.id });
  await tx.insert(workingOrderLines).values(
    pickIds.map((productId, index) => ({
      ...placeholder,
      lineNo: index + 2,
      productId,
      parentLineId: parent!.id,
    })),
  );
  const fired = await tx
    .select({
      id: workingOrderLines.id,
      productId: workingOrderLines.productId,
      courseId: workingOrderLines.courseId,
      parentLineId: workingOrderLines.parentLineId,
      note: workingOrderLines.note,
      quantity: workingOrderLines.quantity,
    })
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, id))
    .orderBy(workingOrderLines.lineNo);
  await fireLines(tx, cfg, id, fired);
  return id;
}

describe("dish extras on kitchen tickets", () => {
  it("names a cancelled weighted extra by its saved physical amount", async () => {
    const { cfg } = await setupVenue();
    const label = await asApp(async (tx) => {
      const station = await createStation(tx, { name: "Kitchen", isDefault: true });
      const dish = await makeProduct(tx, "Toast", { stationId: station.id });
      const { listId, productIds } = await addExtras(tx, cfg, dish, [
        { name: "Ham", customerName: "Smoked ham", kitchenName: "HAM" },
      ]);
      const [kg] = await tx.select({ id: units.id }).from(units).where(eq(units.seedKey, "kg"));
      await assignProductUnit(tx, productIds[0]!, kg!.id);
      await tx.execute(sql`update extra_list_items set portion = 50, max_quantity = 3
        where list_id = ${listId} and product_id = ${productIds[0]}`);
      await fireNewOrder(tx, cfg, [
        {
          productId: dish,
          quantity: "1",
          extras: [{ listId, picks: [{ productId: productIds[0]!, quantity: 3 }] }],
        },
      ]);
      const child = await tx.execute<{ id: string }>(sql`
        select id from working_order_lines where parent_line_id is not null`);
      return (await readCancelledExtra(tx, child.rows[0]!.id, cfg.locale)).label;
    });

    expect(label).toBe("HAM 0.150 kg");
  });

  it("prints the physical amount of a weighted extra from its saved unit", async () => {
    const { cfg } = await setupVenue();
    const { printerId, jobs } = await asApp(async (tx) => {
      const station = await createStation(tx, { name: "Kitchen", isDefault: true });
      const printerId = await makePrinter(tx, "Kitchen printer");
      await attachPrinterToStation(tx, {
        stationId: station.id,
        printerId,
      });
      const dish = await makeProduct(tx, "Toast", { stationId: station.id });
      const { listId, productIds } = await addExtras(tx, cfg, dish, [
        { name: "Ham", customerName: "Smoked ham", kitchenName: "HAM" },
      ]);
      const [kg] = await tx.select({ id: units.id }).from(units).where(eq(units.seedKey, "kg"));
      await assignProductUnit(tx, productIds[0]!, kg!.id);
      await tx.execute(sql`update extra_list_items set portion = 50, max_quantity = 3
        where list_id = ${listId} and product_id = ${productIds[0]}`);
      await fireNewOrder(tx, cfg, [
        {
          productId: dish,
          quantity: "1",
          extras: [{ listId, picks: [{ productId: productIds[0]!, quantity: 3 }] }],
        },
      ]);
      const saved = await tx.execute<{
        id: string;
        quantity: number;
        unit_name: string | null;
      }>(sql`
        select id, quantity, unit_name from working_order_lines where parent_line_id is not null`);
      expect(saved.rows).toHaveLength(1);
      expect(saved.rows[0]!.quantity).toBe(150);
      expect(JSON.parse(saved.rows[0]!.unit_name!)).toMatchObject({ es: "kg" });
      expect(await readLinesSoldInEach(tx, [saved.rows[0]!.id])).toEqual(new Set());
      const context = await tx.execute<{ unit_precision: number; hardware_unit: string }>(sql`
        select offer_unit_precision as unit_precision, hardware_unit from working_order_lines
        where id = ${saved.rows[0]!.id}`);
      expect(context.rows).toEqual([{ unit_precision: 3, hardware_unit: "kg" }]);
      return { printerId, jobs: await printJobsFor(tx) };
    });

    const ticket = decodeTicket(jobs.find((job) => job.printerId === printerId)!.payload);
    expect(ticket).toContain("+ HAM 0.150 kg");
  });

  it.each([
    ["es", "+ HAM 0,150 kg", "HAM 0,150 kg"],
    ["en", "+ HAM 0.150 kg", "HAM 0.150 kg"],
  ])(
    "writes a weighted extra with the decimal mark of a %s kitchen",
    async (kitchenLanguage, printed, cancelled) => {
      const { cfg } = await setupVenue();
      const { printerId, jobs, label } = await asApp(async (tx) => {
        await writeContentLanguages(tx, {
          defaultLanguage: kitchenLanguage,
          languages: ["es", "en"],
        });
        const station = await createStation(tx, { name: "Kitchen", isDefault: true });
        const printerId = await makePrinter(tx, "Kitchen printer");
        await attachPrinterToStation(tx, { stationId: station.id, printerId });
        const dish = await makeProduct(tx, "Toast", { stationId: station.id });
        const { listId, productIds } = await addExtras(tx, cfg, dish, [
          { name: "Ham", customerName: "Smoked ham", kitchenName: "HAM" },
        ]);
        const [kg] = await tx.select({ id: units.id }).from(units).where(eq(units.seedKey, "kg"));
        await assignProductUnit(tx, productIds[0]!, kg!.id);
        await tx.execute(sql`update extra_list_items set portion = 50, max_quantity = 3
          where list_id = ${listId} and product_id = ${productIds[0]}`);
        await fireNewOrder(tx, cfg, [
          {
            productId: dish,
            quantity: "1",
            extras: [{ listId, picks: [{ productId: productIds[0]!, quantity: 3 }] }],
          },
        ]);
        const child = await tx.execute<{ id: string }>(sql`
          select id from working_order_lines where parent_line_id is not null`);
        const { label } = await readCancelledExtra(tx, child.rows[0]!.id, cfg.locale);
        return { printerId, jobs: await printJobsFor(tx), label };
      });

      const ticket = decodeTicket(jobs.find((job) => job.printerId === printerId)!.payload);
      expect(ticket).toContain(printed);
      expect(label).toBe(cancelled);
    },
  );

  // The kitchen looks the line's frozen `unit_name` up under its own `es-ES`, which is no key of it,
  // so it prints that map's first entry. The unit row stores Catalan first, so a line that copied
  // the unit's whole map would print `CA-g`.
  it("prints a measured extra's unit in the default content language, not the language its unit stores first", async () => {
    const { cfg } = await setupVenue();
    const { printerId, jobs } = await asApp(async (tx) => {
      const station = await createStation(tx, { name: "Kitchen", isDefault: true });
      const printerId = await makePrinter(tx, "Kitchen printer");
      await attachPrinterToStation(tx, {
        stationId: station.id,
        printerId,
      });
      const dish = await makeProduct(tx, "Toast", { stationId: station.id });
      const { listId, productIds } = await addExtras(tx, cfg, dish, [
        { name: "Ham", customerName: "Smoked ham", kitchenName: "HAM" },
      ]);
      const [gram] = await tx
        .insert(units)
        .values({
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: { ca: "CA gram", es: "ES gramo" },
          abbreviation: { ca: "CA-g", es: "ES-g" },
          precision: 0,
          hardwareUnit: "g",
        })
        .returning({ id: units.id });
      await assignProductUnit(tx, productIds[0]!, gram!.id);
      await tx.execute(sql`update extra_list_items set portion = 50000, max_quantity = 3
        where list_id = ${listId} and product_id = ${productIds[0]}`);
      await fireNewOrder(tx, cfg, [
        {
          productId: dish,
          quantity: "1",
          extras: [{ listId, picks: [{ productId: productIds[0]!, quantity: 3 }] }],
        },
      ]);
      expect(cfg.locale).toBe("es-ES");
      return { printerId, jobs: await printJobsFor(tx) };
    });

    const ticket = decodeTicket(jobs.find((job) => job.printerId === printerId)!.payload);
    expect(ticket).toContain("+ HAM 150 ES-g");
    expect(ticket).not.toContain("CA-g");
  });

  it("gives the station queue a measured extra's amount on each dish, and no count", async () => {
    const { cfg } = await setupVenue();
    const items = await asApp(async (tx) => {
      const station = await createStation(tx, { name: "Kitchen", isDefault: true });
      const dish = await makeProduct(tx, "Toast", { stationId: station.id });
      const { listId, productIds } = await addExtras(tx, cfg, dish, [
        { name: "Ham", customerName: "Smoked ham", kitchenName: "HAM" },
      ]);
      const [gram] = await tx
        .insert(units)
        .values({
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: { es: "gramo" },
          abbreviation: { es: "g" },
          precision: 0,
          hardwareUnit: "g",
        })
        .returning({ id: units.id });
      await assignProductUnit(tx, productIds[0]!, gram!.id);
      await tx.execute(sql`update extra_list_items set portion = 50000, max_quantity = 3
        where list_id = ${listId} and product_id = ${productIds[0]}`);
      const ham = (count: number) => ({
        productId: dish,
        quantity: "1",
        extras: [{ listId, picks: [{ productId: productIds[0]!, quantity: count }] }],
      });
      await fireNewOrder(tx, cfg, [ham(1), ham(3)]);
      return (await listStationQueue(tx, station.id)).flatMap((group) => group.items);
    });

    expect(
      items.map((item) => item.modifiers.map(({ perDish, amount }) => ({ perDish, amount }))),
    ).toEqual([
      [{ perDish: undefined, amount: "50.000" }],
      [{ perDish: undefined, amount: "150.000" }],
    ]);
  });

  it("gives the station queue and the pass an extra's kitchen name, a measured extra's unit, and an Each extra none", async () => {
    const { cfg } = await setupVenue();
    const { queue, pass } = await asApp(async (tx) => {
      const station = await createStation(tx, { name: "Kitchen", isDefault: true });
      const dish = await makeProduct(tx, "Toast", { stationId: station.id });
      const { listId, productIds } = await addExtras(tx, cfg, dish, [
        { name: "Cheese", customerName: "Mature cheddar", kitchenName: "CHEESE", maxQuantity: 2 },
        { name: "Ham", customerName: "Smoked ham", kitchenName: "HAM" },
      ]);
      const [cheese, ham] = productIds as [string, string];
      const [gram] = await tx
        .insert(units)
        .values({
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: { es: "gramo" },
          abbreviation: { es: "g" },
          precision: 0,
          hardwareUnit: "g",
        })
        .returning({ id: units.id });
      await assignProductUnit(tx, ham, gram!.id);
      await tx.execute(sql`update extra_list_items set portion = 50000, max_quantity = 3
        where list_id = ${listId} and product_id = ${ham}`);
      const orderId = await fireNewOrder(tx, cfg, [
        {
          productId: dish,
          quantity: "1",
          extras: [
            {
              listId,
              picks: [
                { productId: cheese, quantity: 2 },
                { productId: ham, quantity: 3 },
              ],
            },
          ],
        },
      ]);
      return {
        queue: (await listStationQueue(tx, station.id)).flatMap((group) => group.items),
        pass: await readPassRows(tx, sql`${workingOrders.id} = ${orderId}`, Date.now()),
      };
    });

    const shape = (modifiers: QueueModifier[]) =>
      modifiers.map(({ name, perDish, amount, unitName }) => ({ name, perDish, amount, unitName }));
    const expected = [
      { name: "CHEESE", perDish: 2, amount: undefined, unitName: undefined },
      { name: "HAM", perDish: undefined, amount: "150.000", unitName: { es: "g" } },
    ];
    expect(queue.map((item) => shape(item.modifiers))).toEqual([expected]);
    expect(pass.map((row) => shape(row.item.modifiers))).toEqual([expected]);
  });

  it("gives a measured extra made at another station its amount and unit in the dish's cross-reference, and an Each one its count", async () => {
    const { cfg } = await setupVenue();
    const { queue, pass } = await asApp(async (tx) => {
      const station = await createStation(tx, { name: "Kitchen", isDefault: true });
      const fryer = await createStation(tx, { name: "Fryer" });
      const dish = await makeProduct(tx, "Toast", { stationId: station.id });
      const { listId, productIds } = await addExtras(tx, cfg, dish, [
        { name: "Cheese", customerName: "Mature cheddar", kitchenName: "CHEESE", maxQuantity: 2 },
        { name: "Ham", customerName: "Smoked ham", kitchenName: "HAM" },
      ]);
      const [cheese, ham] = productIds as [string, string];
      const [gram] = await tx
        .insert(units)
        .values({
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: { es: "gramo" },
          abbreviation: { es: "g" },
          precision: 0,
          hardwareUnit: "g",
        })
        .returning({ id: units.id });
      await assignProductUnit(tx, ham, gram!.id);
      await tx.execute(sql`update extra_list_items set portion = 50000, max_quantity = 3
        where list_id = ${listId} and product_id = ${ham}`);
      await routeProductTo(tx, cheese, fryer.id);
      await routeProductTo(tx, ham, fryer.id);
      const orderId = await fireNewOrder(tx, cfg, [
        {
          productId: dish,
          quantity: "1",
          extras: [
            {
              listId,
              picks: [
                { productId: cheese, quantity: 2 },
                { productId: ham, quantity: 3 },
              ],
            },
          ],
        },
      ]);
      return {
        queue: (await listStationQueue(tx, station.id)).flatMap((group) => group.items),
        pass: (await readPassRows(tx, sql`${workingOrders.id} = ${orderId}`, Date.now())).filter(
          (row) => row.stationId === station.id,
        ),
      };
    });

    const shape = (refs: QueueCrossRef[] | undefined) =>
      (refs ?? []).map(({ name, perDish, amount, unitName }) => ({
        name,
        perDish,
        amount,
        unitName,
      }));
    const expected = [
      { name: "CHEESE", perDish: 2, amount: undefined, unitName: undefined },
      { name: "HAM", perDish: undefined, amount: "150.000", unitName: { es: "g" } },
    ];
    expect(queue.map((item) => shape(item.crossRefs))).toEqual([expected]);
    expect(pass.map((row) => shape(row.item.crossRefs))).toEqual([expected]);
  });

  it.each(["grouped", "portions"] as const)(
    "gives the station queue each dish's extra count and amount on a counter order of two dishes, not the line's totals (%s)",
    async (shape) => {
      const { cfg } = await setupVenue();
      const { stored, items } = await asApp(async (tx) => {
        const station = await createStation(tx, { name: "Kitchen", isDefault: true });
        const dish = await makeProduct(tx, "Toast", { stationId: station.id });
        const { listId, productIds } = await addExtras(tx, cfg, dish, [
          { name: "Cheese", customerName: "Mature cheddar", kitchenName: "CHEESE", maxQuantity: 2 },
          { name: "Ham", customerName: "Smoked ham", kitchenName: "HAM" },
        ]);
        const [cheese, ham] = productIds as [string, string];
        const [gram] = await tx
          .insert(units)
          .values({
            staffName: "Staff unit",
            staffAbbreviation: "su",
            name: { es: "gramo" },
            abbreviation: { es: "g" },
            precision: 0,
            hardwareUnit: "g",
          })
          .returning({ id: units.id });
        await assignProductUnit(tx, ham, gram!.id);
        await tx.execute(sql`update extra_list_items set portion = 50000, max_quantity = 3
        where list_id = ${listId} and product_id = ${ham}`);
        const fire = shape === "grouped" ? fireGroupedOrder : fireNewOrder;
        const orderId = await fire(tx, cfg, [
          {
            productId: dish,
            quantity: "2",
            extras: [
              {
                listId,
                picks: [
                  { productId: cheese, quantity: 2 },
                  { productId: ham, quantity: 3 },
                ],
              },
            ],
          },
        ]);
        const stored = await tx
          .select({
            productId: workingOrderLines.productId,
            parentLineId: workingOrderLines.parentLineId,
            quantity: workingOrderLines.quantity,
          })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, orderId))
          .orderBy(workingOrderLines.lineNo);
        return {
          stored: stored.map(({ productId, parentLineId, quantity }) => ({
            product: productId === dish ? "dish" : productId === cheese ? "cheese" : "ham",
            child: parentLineId !== null,
            quantity,
          })),
          items: (await listStationQueue(tx, station.id)).flatMap((group) => group.items),
        };
      });

      const dish = (quantity: number, cheese: number, ham: number) => [
        { product: "dish", child: false, quantity },
        { product: "cheese", child: true, quantity: cheese },
        { product: "ham", child: true, quantity: ham },
      ];
      const perDish = [
        { perDish: 2, amount: undefined },
        { perDish: undefined, amount: "150.000" },
      ];
      if (shape === "grouped") {
        expect(stored).toEqual(dish(2000, 4000, 300000));
        expect(
          items.map((item) => item.modifiers.map(({ perDish, amount }) => ({ perDish, amount }))),
        ).toEqual([perDish]);
      } else {
        expect(stored).toEqual([...dish(1000, 2000, 150000), ...dish(1000, 2000, 150000)]);
        expect(
          items.map((item) => item.modifiers.map(({ perDish, amount }) => ({ perDish, amount }))),
        ).toEqual([perDish, perDish]);
      }
    },
  );

  it("prints split chips once on Fryer paper and cross-references both station and pass paper", async () => {
    const venue = await setupSplitExtrasVenue();
    const { cfg, products, lists, printers } = venue;
    const jobs = await asApp(async (tx) => {
      await fireNewOrder(tx, cfg, [
        {
          productId: products.burger,
          quantity: "1",
          extras: [
            {
              listId: lists.burger,
              picks: [
                { productId: products.chips, quantity: 1 },
                { productId: products.cheese, quantity: 1 },
              ],
            },
          ],
        },
      ]);
      return printJobsFor(tx);
    });
    const paper = (printerId: string) =>
      decodeTicket(jobs.find((job) => job.printerId === printerId)!.payload);
    expect(jobs.map((job) => job.printerId)).toEqual(
      expect.arrayContaining([printers.grill, printers.fryer, printers.pass]),
    );
    expect(paper(printers.grill)).toContain("1 x BURG");
    expect(paper(printers.grill)).toContain("+ CHED");
    expect(paper(printers.grill)).toContain("> with CHIPS from Fryer");
    expect(paper(printers.grill)).not.toContain("+ Chips");
    expect(paper(printers.fryer)).toContain("1 x CHIPS");
    expect(
      printedLines(jobs.find((job) => job.printerId === printers.fryer)!.payload).filter((line) =>
        line.includes("x CHIPS"),
      ),
    ).toHaveLength(1);
    expect(paper(printers.fryer)).toContain("> for BURG at Grill");
    expect(paper(printers.pass)).toContain("> with CHIPS from Fryer");
    expect(paper(printers.pass)).toContain("> for BURG at Grill");
    expect(
      printedLines(jobs.find((job) => job.printerId === printers.pass)!.payload).filter((line) =>
        line.includes("x CHIPS"),
      ),
    ).toHaveLength(1);
    for (const job of jobs) {
      expect(decodeTicket(job.payload)).not.toContain("Hand-cut fries");
      expect(decodeTicket(job.payload)).not.toContain("Classic beef burger");
    }
  });

  it("prints a split-off measured extra's saved amount on both station tickets", async () => {
    const venue = await setupSplitExtrasVenue();
    const { cfg, products, lists, printers } = venue;
    const jobs = await asApp(async (tx) => {
      const [kg] = await tx.select({ id: units.id }).from(units).where(eq(units.seedKey, "kg"));
      await assignProductUnit(tx, products.chips, kg!.id);
      await tx.execute(sql`update extra_list_items set portion = 50, max_quantity = 3
        where list_id = ${lists.burger} and product_id = ${products.chips}`);
      await fireNewOrder(tx, cfg, [
        {
          productId: products.burger,
          quantity: "1",
          extras: [{ listId: lists.burger, picks: [{ productId: products.chips, quantity: 3 }] }],
        },
      ]);
      return printJobsFor(tx);
    });

    const paper = (printerId: string) =>
      decodeTicket(jobs.find((job) => job.printerId === printerId)!.payload);
    expect(paper(printers.grill)).toContain("CHIPS 0.150 kg from Fryer");
    expect(paper(printers.fryer)).toContain("0.150 kg x CHIPS");
    expect(paper(printers.fryer)).toContain("for BURG at Grill");
  });

  it("keeps an unclaimed cheese as a modifier without a Fryer job", async () => {
    const { cfg, products, lists, printers } = await setupSplitExtrasVenue();
    const jobs = await asApp(async (tx) => {
      await fireNewOrder(tx, cfg, [
        {
          productId: products.burger,
          quantity: "1",
          extras: [{ listId: lists.burger, picks: [{ productId: products.cheese, quantity: 1 }] }],
        },
      ]);
      return printJobsFor(tx);
    });
    expect(jobs.some((job) => job.printerId === printers.fryer)).toBe(false);
    const paper = decodeTicket(jobs.find((job) => job.printerId === printers.grill)!.payload);
    expect(paper).toContain("+ CHED");
    expect(paper).not.toContain("  > ");
  });

  it("names no preparation for a water's split chips", async () => {
    const { cfg, products, lists, printers } = await setupSplitExtrasVenue();
    const jobs = await asApp(async (tx) => {
      await fireNewOrder(tx, cfg, [
        {
          productId: products.water,
          quantity: "1",
          extras: [{ listId: lists.water, picks: [{ productId: products.chips, quantity: 1 }] }],
        },
      ]);
      return printJobsFor(tx);
    });
    expect(jobs.some((job) => job.printerId === printers.grill)).toBe(false);
    expect(decodeTicket(jobs.find((job) => job.printerId === printers.fryer)!.payload)).toContain(
      "> for H2O, no preparation",
    );
  });

  it("keeps the Fryer and Kitchen references on separate burger lines in a reprint", async () => {
    const { cfg, products, lists, printers, stations, tables, party } =
      await setupSplitExtrasVenue();
    const jobs = await asApp(async (tx) => {
      const pick = {
        menuItemId: tables.offerFor(products.burger),
        quantity: "1",
        extras: [{ listId: lists.burger, picks: [{ productId: products.chips, quantity: 1 }] }],
      };
      const orderId = party.tabId;
      await addTabRound(tx, cfg, orderId, [pick]);
      await setStationToday(tx, stations.fryer, "closed", new Date(), await seedActivityActor(tx));
      await addTabRound(tx, cfg, orderId, [pick]);
      const before = new Set((await printJobsFor(tx)).map((job) => job.id));
      await reprintOrderTickets(tx, cfg, orderId);
      return (await printJobsFor(tx)).filter((job) => !before.has(job.id));
    });
    const grill = decodeTicket(jobs.find((job) => job.printerId === printers.grill)!.payload);
    expect(grill).toContain("> with CHIPS from Fryer");
    expect(grill).toContain("> with CHIPS from Kitchen");
    expect(
      printedLines(jobs.find((job) => job.printerId === printers.grill)!.payload).filter((line) =>
        line.includes("x BURG"),
      ),
    ).toHaveLength(2);
    expect(grill).not.toContain("2 x BURG");
  });

  it("keeps both references on the burger and chips VOID slips", async () => {
    const { cfg, products, lists, printers } = await setupSplitExtrasVenue();
    const jobs = await asApp(async (tx) => {
      const orderId = await fireNewOrder(tx, cfg, [
        {
          productId: products.burger,
          quantity: "1",
          extras: [{ listId: lists.burger, picks: [{ productId: products.chips, quantity: 1 }] }],
        },
      ]);
      const records = await tx
        .select({
          workingOrderLineId: ticketItems.workingOrderLineId,
          stationId: ticketItems.stationId,
        })
        .from(ticketItems)
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
        .where(eq(workingOrderLines.workingOrderId, orderId));
      const before = new Set((await printJobsFor(tx)).map((job) => job.id));
      await enqueueCorrectionSlips(
        tx,
        cfg,
        orderId,
        records.map((record) => ({ ...record, quantity: 1000, wasStarted: false })),
        "VOID",
      );
      return (await printJobsFor(tx)).filter((job) => !before.has(job.id));
    });
    expect(decodeTicket(jobs.find((job) => job.printerId === printers.grill)!.payload)).toContain(
      "> with CHIPS from Fryer",
    );
    expect(decodeTicket(jobs.find((job) => job.printerId === printers.fryer)!.payload)).toContain(
      "> for BURG at Grill",
    );
  });

  it("prints held chips once at Fryer and only as a reference at Grill", async () => {
    const { cfg, products, lists, printers, party, tables } = await setupSplitExtrasVenue();
    const jobs = await asApp(async (tx) => {
      await setStationPrinting(tx, { printHeldWork: true });
      await placeGroups(tx, cfg, party.partyId, {
        operatorId: OPERATOR,
        groups: [
          {
            release: "hold",
            lines: [
              {
                menuItemId: tables.offerFor(products.burger),
                quantity: "1",
                extras: [
                  { listId: lists.burger, picks: [{ productId: products.chips, quantity: 1 }] },
                ],
              },
            ],
          },
        ],
      });
      return printJobsFor(tx);
    });
    const grill = decodeTicket(jobs.find((job) => job.printerId === printers.grill)!.payload);
    const fryer = decodeTicket(jobs.find((job) => job.printerId === printers.fryer)!.payload);
    expect(grill).toContain("*** HOLD ***");
    expect(grill).toContain("> with CHIPS from Fryer");
    expect(grill).not.toContain("+ Chips");
    expect(fryer).toContain("*** HOLD ***");
    expect(
      printedLines(jobs.find((job) => job.printerId === printers.fryer)!.payload).filter((line) =>
        line.includes("x CHIPS"),
      ),
    ).toHaveLength(1);
    expect(fryer).toContain("> for BURG at Grill");
  });

  it("keeps two extras no cell decides on their dish's one kitchen record", async () => {
    const { cfg } = await setupVenue();
    const { orderId, parentLineId, ticketItemRows } = await asApp(async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const printerId = await makePrinter(tx, "Kitchen printer");
      await attachPrinterToStation(tx, {
        stationId: kitchenStation.id,
        printerId,
      });
      // No cell decides for either extra, so both follow their dish instead of the default.
      const espressoProduct = await makeProduct(tx, "Flat white", {
        stationId: kitchenStation.id,
      });
      const { listId, productIds } = await addExtras(
        tx,
        cfg,
        espressoProduct,
        [{ name: "Cream" }, { name: "Oat milk" }],
        { staffNameOnly: true },
      );

      const orderId = await fireNewOrder(tx, cfg, [
        {
          productId: espressoProduct,
          quantity: "1",
          extras: [{ listId, picks: productIds.map((productId) => ({ productId, quantity: 1 })) }],
        },
      ]);
      const lines = await tx
        .select({
          id: workingOrderLines.id,
          productId: workingOrderLines.productId,
          parentLineId: workingOrderLines.parentLineId,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId))
        .orderBy(workingOrderLines.lineNo);
      expect(lines).toHaveLength(3);
      const parent = lines.find((l) => l.parentLineId === null)!;
      const ticketItemRows = await tx
        .select({ workingOrderLineId: ticketItems.workingOrderLineId })
        .from(ticketItems)
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
        .where(eq(workingOrderLines.workingOrderId, orderId));
      return { orderId, parentLineId: parent.id, ticketItemRows };
    });

    expect(ticketItemRows).toEqual([{ workingOrderLineId: parentLineId }]);
    expect(orderId).toBeTruthy();
  });

  it("renders the dish then its two extras as indented '+' sub-text on the kitchen ticket", async () => {
    const { cfg } = await setupVenue();
    const { printerId, jobs } = await asApp(async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const printerId = await makePrinter(tx, "Kitchen printer");
      await attachPrinterToStation(tx, {
        stationId: kitchenStation.id,
        printerId,
      });
      const espressoProduct = await makeProduct(tx, "Flat white", {
        stationId: kitchenStation.id,
      });
      // Each extra carries three DIFFERENT names, so a sub-line that read the staff or customer-facing
      // text instead of the kitchen name the child line froze reads differently (CLAUDE.md §3).
      const { listId, productIds } = await addExtras(tx, cfg, espressoProduct, [
        { name: "Cream", customerName: "Whipped cream", kitchenName: "CRM" },
        { name: "Oat milk", customerName: "Oat drink", kitchenName: "OAT" },
      ]);

      await fireNewOrder(tx, cfg, [
        {
          productId: espressoProduct,
          quantity: "1",
          extras: [{ listId, picks: productIds.map((productId) => ({ productId, quantity: 1 })) }],
        },
      ]);
      return { printerId, jobs: await printJobsFor(tx) };
    });

    const stationJobs = jobs.filter((j) => j.printerId === printerId);
    expect(stationJobs).toHaveLength(1);
    const ticket = decodeTicket(stationJobs[0]!.payload);
    expect(ticket).toContain("Flat white");
    expect(ticket).toContain("+ CRM");
    expect(ticket).toContain("+ OAT");
    expect(ticket).not.toContain("Cream");
    expect(ticket).not.toContain("Oat milk");
    expect(ticket).not.toContain("Whipped cream");
    expect(ticket).not.toContain("Oat drink");
    expect(ticket.indexOf("Flat white")).toBeLessThan(ticket.indexOf("+ CRM"));
    expect(ticket.indexOf("Flat white")).toBeLessThan(ticket.indexOf("+ OAT"));
  });

  it("names an extra with no kitchen name by its staff name, never its customer-facing one, on paper, the station queue and the pass", async () => {
    const { cfg } = await setupVenue();
    const { printerId, jobs, queue, pass } = await asApp(async (tx) => {
      const station = await createStation(tx, { name: "Kitchen", isDefault: true });
      const printerId = await makePrinter(tx, "Kitchen printer");
      await attachPrinterToStation(tx, { stationId: station.id, printerId });
      const dish = await makeProduct(tx, "Flat white", { stationId: station.id });
      const { listId, productIds } = await addExtras(
        tx,
        cfg,
        dish,
        [{ name: "Cream", customerName: "Whipped cream" }],
        { staffNameOnly: true },
      );
      const orderId = await fireNewOrder(tx, cfg, [
        {
          productId: dish,
          quantity: "1",
          extras: [{ listId, picks: [{ productId: productIds[0]!, quantity: 1 }] }],
        },
      ]);
      return {
        printerId,
        jobs: await printJobsFor(tx),
        queue: (await listStationQueue(tx, station.id)).flatMap((group) => group.items),
        pass: await readPassRows(tx, sql`${workingOrders.id} = ${orderId}`, Date.now()),
      };
    });

    const ticket = decodeTicket(jobs.filter((j) => j.printerId === printerId)[0]!.payload);
    expect(ticket).toContain("+ Cream");
    expect(ticket).not.toContain("Whipped cream");
    expect(queue.map((item) => item.modifiers.map(({ name }) => name))).toEqual([["Cream"]]);
    expect(pass.map((row) => row.item.modifiers.map(({ name }) => name))).toEqual([["Cream"]]);
  });

  it("prints the line's note as a sub-line on the kitchen ticket (order-line customisation)", async () => {
    const { cfg } = await setupVenue();
    const { printerId, jobs } = await asApp(async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const printerId = await makePrinter(tx, "Kitchen printer");
      await attachPrinterToStation(tx, {
        stationId: kitchenStation.id,
        printerId,
      });
      const steakProduct = await makeProduct(tx, "Ribeye", {
        stationId: kitchenStation.id,
      });

      await fireNewOrder(tx, cfg, [{ productId: steakProduct, quantity: "1", note: "no salt" }]);
      return { printerId, jobs: await printJobsFor(tx) };
    });

    const ticket = decodeTicket(jobs.filter((j) => j.printerId === printerId)[0]!.payload);
    expect(ticket).toContain("Ribeye");
    expect(ticket).toContain("* no salt");
    expect(ticket.indexOf("Ribeye")).toBeLessThan(ticket.indexOf("* no salt"));
  });

  it("badges an extra's PER-DISH count when it exceeds one, leaving a single pick's line unchanged", async () => {
    // A child line stores the combined quantity (dish × pick); the ticket shows the per-dish count as
    // an ASCII "xN" suffix only when it exceeds 1.
    const { cfg } = await setupVenue();
    const { printerId, jobs } = await asApp(async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const printerId = await makePrinter(tx, "Kitchen printer");
      await attachPrinterToStation(tx, {
        stationId: kitchenStation.id,
        printerId,
      });
      const espressoProduct = await makeProduct(tx, "Flat white", {
        stationId: kitchenStation.id,
      });
      const { listId, productIds } = await addExtras(tx, cfg, espressoProduct, [
        // a per-dish cap of 3 admits a ×2
        { name: "Cream", customerName: "Whipped cream", kitchenName: "CRM", maxQuantity: 3 },
        { name: "Oat milk", customerName: "Oat drink", kitchenName: "OAT" }, // single pick (cap 1)
      ]);
      const [creamExtra, oatMilkExtra] = productIds;

      await fireNewOrder(tx, cfg, [
        {
          productId: espressoProduct,
          quantity: "1",
          extras: [
            {
              listId,
              picks: [
                { productId: creamExtra!, quantity: 2 },
                { productId: oatMilkExtra!, quantity: 1 },
              ],
            },
          ],
        },
      ]);
      return { printerId, jobs: await printJobsFor(tx) };
    });

    const stationJobs = jobs.filter((j) => j.printerId === printerId);
    expect(stationJobs).toHaveLength(1);
    const ticket = decodeTicket(stationJobs[0]!.payload);
    expect(ticket).toContain("Flat white");
    expect(ticket).toContain("+ CRM x2");
    expect(ticket).toContain("+ OAT");
    expect(ticket).not.toContain("OAT x");
    expect(ticket).not.toMatch(/\+ CRM(?! x)/u);
  });

  it("lets an unclaimed extra follow its dish when no default station is on", async () => {
    const { cfg } = await setupVenue();
    const { stationId, ticketItemRows } = await asApp(async (tx) => {
      const barStation = await createStation(tx, { name: "Bar", isDefault: false });
      const coffeeProduct = await makeProduct(tx, "Filter coffee", {
        stationId: barStation.id,
      });
      const { productIds } = await addExtras(tx, cfg, coffeeProduct, [{ name: "Cream" }], {
        staffNameOnly: true,
      });

      const orderId = await fireContextlessDish(tx, cfg, coffeeProduct, [productIds[0]!]);
      const ticketItemRows = await tx
        .select({
          workingOrderLineId: ticketItems.workingOrderLineId,
          stationId: ticketItems.stationId,
        })
        .from(ticketItems)
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
        .where(eq(workingOrderLines.workingOrderId, orderId));
      return { stationId: barStation.id, ticketItemRows };
    });

    expect(ticketItemRows).toHaveLength(1);
    expect(ticketItemRows[0]!.stationId).toBe(stationId);
  });
});
