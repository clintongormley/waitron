import { seedPerson } from "@waitron/db/testing/seed.js";
import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  kitchenCourses,
  kitchenStations,
  nowIso,
  partyTables,
  printJobs,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { EACH_UNIT, createProduct, readContentLanguages, units, updateUnit } from "@waitron/menu";
import { thousandthsToDecimal } from "@waitron/shared";
import { createCourse, createStation, setProductCourse, updateCourse } from "./kitchen.js";
import { createOpenOrder } from "./working-order-open.js";
import { fireLines } from "./working-order-kitchen-fire.js";
import { setStationPrinting } from "./testing/station-printing.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { reorderHeldGroups } from "./order-group-edits.js";
import { fireGroup } from "./order-group-release.js";
import { attachPrinterToStation } from "./station-printers.js";
import { reprintOrderTickets } from "./kitchen-ticket-reprint.js";
import { enqueueCorrectionSlips } from "./kitchen-ticket-corrections.js";
import { enqueueKitchenTickets } from "./kitchen-ticket-enqueue.js";
import { orderTableLabel } from "./kitchen-ticket-items.js";
import { deleteCourse } from "./course-delete.js";
import { decodeTicket, printedLines } from "./testing/decode-ticket.js";
import { routeProductTo, offerProducts } from "./testing/zone-offers.js";
import {
  billRow,
  counterOrder,
  inTx,
  join,
  nameParty,
  nextMillisecond,
  order,
  orderForParty,
  pay,
  revisionOf,
  seat,
  seatWithNoAllergies,
  setupPartyVenue,
  split,
  tableAt,
  type PartyVenue,
} from "./testing/party-venue.js";
import { moveGuests } from "./testing/table-action-fixture.js";
import "./errors.js";
import {
  setupVenue,
  fireNewOrder,
  fireGroupedOrder,
  createOfferedOrder,
  useSplitExtrasDb,
} from "./testing/split-extras-venue.js";
import { openPartyTab } from "./testing/serve-line.js";
import { cancelLine } from "./testing/cancel-line.js";
import { addPortionRound } from "./testing/portion-bill.js";
import { createTable } from "./testing/live-table.js";
import {
  bindKitchenPrintDb,
  useKitchenPrintDb,
  db,
  OPERATOR,
  LOCALE,
  asApp,
  printJobsFor,
  line,
  makeProduct,
  makePrinter,
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

describe("a dish sold by the piece prints no unit", () => {
  /**
   * Five dishes at the Kitchen station, each sold in a different unit: Croquette in Each as a
   * product with no stored unit, Meatball in the stored unit seeded "each", renamed so only its
   * identity marks it Each, Octopus in the kg seed, Almonds in grams, and Bread in a stored unit
   * spelled exactly like Each but not seeded as it.
   */
  async function sellInEveryUnit(tx: Transaction) {
    const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
    const printerId = await makePrinter(tx, "Kitchen printer");
    await attachPrinterToStation(tx, {
      stationId: kitchenStation.id,
      printerId,
    });
    const [seededEach] = await tx
      .select({ id: units.id })
      .from(units)
      .where(eq(units.seedKey, "each"));
    await updateUnit(tx, seededEach!.id, { abbreviation: { es: "pz" } }, "es");
    const grams = { en: "g", es: "g", ca: "g", gl: "g", eu: "g" };
    const [gram, lookAlike] = await tx
      .insert(units)
      .values([
        {
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: grams,
          abbreviation: grams,
          precision: 0,
          hardwareUnit: "g",
        },
        {
          staffName: "Staff unit",
          staffAbbreviation: "su",
          name: { en: "piece", es: "pieza", ca: "peça", gl: "peza", eu: "pieza" },
          abbreviation: EACH_UNIT.abbreviation,
          precision: 0,
          hardwareUnit: null,
        },
      ])
      .returning({ id: units.id });
    const dish = async (
      name: string,
      unit: { unitId: string } | { pricingUnit: "each" | "weight" },
    ) => {
      const { id } = await createProduct(tx, {
        categoryId: null,
        name,
        ...unit,
        unitPrice: "1.50",
        vatClass: "general",
      });
      await routeProductTo(tx, id, kitchenStation.id);
      return id;
    };
    return {
      printerId,
      croquette: await dish("Croquette", { pricingUnit: "each" }),
      meatball: await dish("Meatball", { unitId: seededEach!.id }),
      octopus: await dish("Octopus", { pricingUnit: "weight" }),
      almonds: await dish("Almonds", { unitId: gram!.id }),
      bread: await dish("Bread", { unitId: lookAlike!.id }),
    };
  }

  it("leaves the unit out for a dish sold in Each, and keeps it for every other unit", async () => {
    const { cfg } = await setupVenue();
    const jobs = await asApp(async (tx) => {
      const sold = await sellInEveryUnit(tx);
      await fireNewOrder(tx, cfg, [
        { productId: sold.croquette, quantity: "2" },
        { productId: sold.meatball, quantity: "3" },
        { productId: sold.octopus, quantity: "0.5" },
        { productId: sold.almonds, quantity: "200" },
        { productId: sold.bread, quantity: "1" },
      ]);
      return printJobsFor(tx);
    });

    expect(jobs).toHaveLength(1);
    const lines = printedLines(jobs[0]!.payload);
    expect(lines).toContain(`2 x Croquette`);
    expect(lines).toContain(`3 x Meatball`);
    expect(lines).toContain(`${thousandthsToDecimal(500)} kg x Octopus`);
    expect(lines).toContain(`200 g x Almonds`);
    // Spelled like Each, but a unit of the venue's own: its abbreviation still prints, in the
    // default content language the line stored it in.
    expect(lines).toContain(`1 ud x Bread`);
  });

  it("a correction slip also leaves out the Each unit", async () => {
    const { cfg } = await setupVenue();
    const slips = await asApp(async (tx) => {
      const sold = await sellInEveryUnit(tx);
      const orderId = await fireNewOrder(tx, cfg, [
        { productId: sold.croquette, quantity: "2" },
        { productId: sold.octopus, quantity: "0.5" },
      ]);
      const fired = await tx
        .select({
          workingOrderLineId: ticketItems.workingOrderLineId,
          stationId: ticketItems.stationId,
          quantity: ticketItems.quantity,
        })
        .from(ticketItems)
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
        .where(eq(workingOrderLines.workingOrderId, orderId));
      const before = new Set((await printJobsFor(tx)).map((job) => job.id));
      await enqueueCorrectionSlips(
        tx,
        cfg,
        orderId,
        fired.map((item) => ({
          workingOrderLineId: item.workingOrderLineId,
          stationId: item.stationId!,
          quantity: item.quantity!,
          wasStarted: false,
        })),
        "VOID",
      );
      return (await printJobsFor(tx)).filter((job) => !before.has(job.id));
    });

    expect(slips).toHaveLength(2);
    const printed = slips.flatMap((slip) => printedLines(slip.payload));
    expect(printed).toContain(`2 x Croquette`);
    expect(printed).toContain(`${thousandthsToDecimal(500)} kg x Octopus`);
  });

  // Fails if merging and splitting go by the unit's spelling while the unit's printing goes by its
  // identity: Bread's unit is spelled like Each but is the venue's own, and Meatball's is Each renamed.
  // `["2"]` is one stored line of two, as a counter order written before portions holds it.
  it.each([
    {
      grouping: "combined",
      dish: "bread",
      name: "Bread",
      sold: ["1", "1"],
      printed: ["1 ud x Bread", "1 ud x Bread"],
    },
    {
      grouping: "separate",
      dish: "bread",
      name: "Bread",
      sold: ["2"],
      printed: ["2 ud x Bread"],
    },
    {
      grouping: "combined",
      dish: "meatball",
      name: "Meatball",
      sold: ["1", "1"],
      printed: ["2 x Meatball"],
    },
    {
      grouping: "separate",
      dish: "meatball",
      name: "Meatball",
      sold: ["2"],
      printed: ["1 x Meatball", "1 x Meatball"],
    },
  ] as const)(
    "merges or splits an entry only when its unit does not print ($dish, $grouping)",
    async ({ grouping, dish, name, sold, printed }) => {
      const { cfg } = await setupVenue();
      const jobs = await asApp(async (tx) => {
        const dishes = await sellInEveryUnit(tx);
        const [kitchenStation] = await tx
          .select({ id: kitchenStations.id })
          .from(kitchenStations)
          .where(eq(kitchenStations.name, "Kitchen"));
        await setStationPrinting(tx, { ticketGrouping: grouping }, [kitchenStation!.id]);
        await fireGroupedOrder(
          tx,
          cfg,
          sold.map((quantity) => ({ productId: dishes[dish], quantity })),
        );
        return printJobsFor(tx);
      });

      expect(jobs).toHaveLength(1);
      expect(printedLines(jobs[0]!.payload).filter((text) => text.endsWith(` x ${name}`))).toEqual(
        printed,
      );
    },
  );

  it.each(["separate", "combined"] as const)(
    "A1208: two of a dish whose unit prints, sold at the counter, print as a table's portions do (%s)",
    async (grouping) => {
      const { cfg } = await setupVenue();
      const { counter, table } = await asApp(async (tx) => {
        const dishes = await sellInEveryUnit(tx);
        const [kitchenStation] = await tx
          .select({ id: kitchenStations.id })
          .from(kitchenStations)
          .where(eq(kitchenStations.name, "Kitchen"));
        await setStationPrinting(tx, { ticketGrouping: grouping }, [kitchenStation!.id]);
        const newJobs = async (fn: () => Promise<unknown>) => {
          const before = new Set((await printJobsFor(tx)).map((job) => job.id));
          await fn();
          return (await printJobsFor(tx)).filter((job) => !before.has(job.id));
        };
        const offers = await offerProducts(tx, { zone: "tables" });
        const { id: tableId } = await createTable(tx, { label: "T", zoneId: offers.zoneId });
        const { tabId } = await openPartyTab(tx, cfg, { tableId });
        return {
          counter: await newJobs(() =>
            fireNewOrder(tx, cfg, [{ productId: dishes.bread, quantity: "2" }]),
          ),
          table: await newJobs(() =>
            addPortionRound(
              tx,
              cfg,
              tabId,
              [{ menuItemId: offers.offerFor(dishes.bread), quantity: "2" }],
              { fire: true },
            ),
          ),
        };
      });

      const breads = (jobs: { payload: Uint8Array }[]) => {
        expect(jobs).toHaveLength(1);
        return printedLines(jobs[0]!.payload).filter((text) => text.endsWith(" x Bread"));
      };
      expect(breads(counter)).toEqual(["1 ud x Bread", "1 ud x Bread"]);
      expect(breads(table)).toEqual(breads(counter));
    },
  );

  it("each station's part of a shared printer's ticket follows its own ticket grouping", async () => {
    const { cfg } = await setupVenue();
    const jobs = await asApp(async (tx) => {
      const grill = await createStation(tx, { name: "Grill", isDefault: true });
      const cold = await createStation(tx, { name: "Cold" });
      await setStationPrinting(tx, { ticketGrouping: "separate" }, [grill.id]);
      await setStationPrinting(tx, { ticketGrouping: "combined" }, [cold.id]);
      await makeSharedPrinter(tx, "Pass", [grill.id, cold.id]);
      const burger = await makeProduct(tx, "Burger", { stationId: grill.id });
      const salad = await makeProduct(tx, "Salad", { stationId: cold.id });
      await fireNewOrder(tx, cfg, [
        { productId: burger, quantity: "3" },
        { productId: salad, quantity: "2" },
      ]);
      return printJobsFor(tx);
    });

    expect(jobs).toHaveLength(1);
    const lines = printedLines(jobs[0]!.payload);
    expect(lines.filter((text) => text.endsWith(" x Burger"))).toEqual([
      "1 x Burger",
      "1 x Burger",
      "1 x Burger",
    ]);
    expect(lines.filter((text) => text.endsWith(" x Salad"))).toEqual(["2 x Salad"]);
  });
});

it("prints a line's stored options answers, each side taking its KITCHEN name", async () => {
  const { cfg } = await setupVenue();
  const jobs = await asApp(async (tx) => {
    const station = await createStation(tx, { name: "Kitchen", isDefault: true });
    const printerId = await makePrinter(tx, "Kitchen printer");
    await attachPrinterToStation(tx, {
      stationId: station.id,
      printerId,
    });
    const productId = await makeProduct(tx, "Coffee", { stationId: station.id });
    const orderId = randomUUID();
    const { lineRows } = await createOfferedOrder(tx, cfg, orderId, [line(productId)]);
    const parent = lineRows[0]!;
    // A frozen answer's two staff names are keyed by CONTENT language, which is what the order path
    // widens them under (`buildLineExtras`, modifier-selection.ts).
    const { defaultLanguage } = await readContentLanguages(tx, cfg.locale);
    await tx
      .update(workingOrderLines)
      .set({
        optionSnapshots: [
          // Six names, six different texts: the ticket can only print the kitchen pair.
          {
            listName: { [defaultLanguage]: "Milk staff" },
            listCustomerName: { [defaultLanguage]: "Milk customer" },
            listKitchenName: "MILK",
            labelName: { [defaultLanguage]: "Oat staff" },
            labelCustomerName: { [defaultLanguage]: "Oat customer" },
            labelKitchenName: "OAT",
          },
          // Neither side has a kitchen name: a cook reads the STAFF name, never the diner's wording.
          {
            listName: { [defaultLanguage]: "Sugar" },
            listCustomerName: { [defaultLanguage]: "Sugar customer" },
            listKitchenName: null,
            labelName: { [defaultLanguage]: "None" },
            labelCustomerName: { [defaultLanguage]: "None customer" },
            labelKitchenName: null,
          },
        ],
      })
      .where(eq(workingOrderLines.id, parent.id!));
    await enqueueKitchenTickets(tx, cfg, orderId, [
      { workingOrderLineId: parent.id!, stationId: station.id },
    ]);
    return printJobsFor(tx);
  });
  expect(jobs).toHaveLength(1);
  const paper = decodeTicket(jobs[0]!.payload);
  expect(paper).toContain("+ MILK: OAT");
  expect(paper).not.toContain("Milk staff");
  expect(paper).toContain("+ Sugar: None");
  expect(paper).not.toContain("customer");
});

/**
 * Fire one line whose frozen kitchen/variant names are `frozen`, and return the printed ticket. The
 * staff name and the customer-facing text differ, so the ticket shows which one it fell back to.
 */
async function ticketWithNames(frozen: {
  kitchenName: string | null;
  variantName: string | null;
  variantKitchenName: string | null;
}): Promise<string> {
  const { cfg } = await setupVenue();
  const jobs = await asApp(async (tx) => {
    const station = await createStation(tx, { name: "Kitchen", isDefault: true });
    const printerId = await makePrinter(tx, "Kitchen printer");
    await attachPrinterToStation(tx, {
      stationId: station.id,
      printerId,
    });
    const { id: productId } = await createProduct(tx, {
      categoryId: null,
      name: "Coffee",
      customerName: { [LOCALE]: "Fresh filter brew" },
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    await routeProductTo(tx, productId, station.id);
    const orderId = randomUUID();
    const { lineRows } = await createOfferedOrder(tx, cfg, orderId, [line(productId)]);
    const parent = lineRows[0]!;
    await tx.update(workingOrderLines).set(frozen).where(eq(workingOrderLines.id, parent.id!));
    await enqueueKitchenTickets(tx, cfg, orderId, [
      { workingOrderLineId: parent.id!, stationId: station.id },
    ]);
    return printJobsFor(tx);
  });
  return decodeTicket(jobs[0]!.payload);
}

it("prints the frozen product and relative variant kitchen names", async () => {
  const paper = await ticketWithNames({
    kitchenName: "COF",
    variantName: "Large",
    variantKitchenName: "LG",
  });
  expect(paper).toContain("COF (LG)");
  expect(paper).not.toContain("Coffee");
});

it("falls back to the variant's staff name when it has no kitchen name", async () => {
  const paper = await ticketWithNames({
    kitchenName: "COF",
    variantName: "Large",
    variantKitchenName: null,
  });
  expect(paper).toContain("COF (Large)");
});

it("falls back to the product's staff name when it has no kitchen name", async () => {
  const paper = await ticketWithNames({
    kitchenName: null,
    variantName: null,
    variantKitchenName: null,
  });
  expect(paper).toContain("Coffee");
  expect(paper).not.toContain("Fresh filter brew");
});

describe("the table a slip names (spec decision 9)", () => {
  it("names every table of the party, in the order they joined", async () => {
    const v = await setupPartyVenue(db);
    // Joined Table 5 first: sorting by id or by label would both put Table 4 first.
    const table4 = await tableAt(v, `00000000-${randomUUID().slice(9)}`, "Table 4");
    const table5 = await tableAt(v, `ffffffff-${randomUUID().slice(9)}`, "Table 5");
    const { partyId, tabId } = await seat(v, table5);
    await join(v, partyId, table4);
    await orderForParty(v, partyId, ["Burger"], tabId);

    expect(await inTx(v, (tx) => orderTableLabel(tx, tabId))).toBe("Table 5, 4");
  });

  it("names the party's tables on a bill split from the tab, not the label it was split with", async () => {
    const v = await setupPartyVenue(db);
    const table4 = await v.table("Table 4");
    const table5 = await v.table("Table 5");
    const { partyId, tabId } = await seat(v, table4);
    await orderForParty(v, partyId, ["Burger", "Red wine bottle"], tabId);
    const checkId = await split(v, partyId, tabId, [2]);
    await join(v, partyId, table5);

    expect((await billRow(v, checkId)).label).toBe("Table 4");
    expect(await inTx(v, (tx) => orderTableLabel(tx, checkId))).toBe("Table 4, 5");
  });

  it("copies the party's tables, not its name, as a split bill's own label", async () => {
    const v = await setupPartyVenue(db);
    const table4 = await v.table("Table 4");
    const table5 = await v.table("Table 5");
    const { partyId, tabId } = await seat(v, table4);
    await join(v, partyId, table5);
    await nameParty(v, partyId, "Ana");
    await orderForParty(v, partyId, ["Burger", "Red wine bottle"], tabId);

    const checkId = await split(v, partyId, tabId, [2]);

    expect((await billRow(v, checkId)).label).toBe("Table 4, 5");
  });

  it("names a bill by its own label once its party holds no table", async () => {
    const v = await setupPartyVenue(db);
    const table4 = await v.table("Table 4");
    const { partyId, tabId } = await seat(v, table4);
    await orderForParty(v, partyId, ["Burger", "Red wine bottle"], tabId);
    const checkId = await split(v, partyId, tabId, [2]);
    await inTx(v, async (tx) => {
      await tx
        .update(partyTables)
        .set({ leftAt: nowIso() })
        .where(eq(partyTables.partyId, partyId));
      await tx.update(workingOrders).set({ label: "Ana" }).where(eq(workingOrders.id, checkId));
    });

    expect(await inTx(v, (tx) => orderTableLabel(tx, checkId))).toBe("Ana");
  });

  it("names a counter order's delivery table, and an unlabelled walk-up nothing", async () => {
    const v = await setupPartyVenue(db);
    const terraceTable = await v.table("Terrace 2");
    const [delivered, walkUp] = [randomUUID(), randomUUID()];
    await inTx(v, async (tx) => {
      await createOpenOrder(tx, v.cfg, delivered, [], null, { deliveryTableId: terraceTable });
      await createOpenOrder(tx, v.cfg, walkUp, [], null);
    });

    expect(await inTx(v, (tx) => orderTableLabel(tx, delivered))).toBe("Terrace 2");
    expect(await inTx(v, (tx) => orderTableLabel(tx, walkUp))).toBeNull();
  });
});

describe("the party's name on a kitchen ticket", () => {
  it("A1378 includes the current party name on a queued correction", async () => {
    const v = await setupPartyVenue(db);
    const printer = await kitchenPrinter(v);
    const p = await seat(v, await v.table("Table 70"));
    await nameParty(v, p.partyId, "Ana");
    await order(v, p.tabId, "Burger", "Burger");
    const before = (await ticketsSince(printer)).length;
    await inTx(v, (tx) => cancelLine(tx, v.cfg, p.tabId, 1));
    const corrections = await ticketsSince(printer, before);
    expect(corrections).toHaveLength(1);
    expect(corrections[0]![3]).toBe(
      `${kitchenTicketWords("es").order} ${(await billRow(v, p.tabId)).orderNumber} · Ana`,
    );
    expect(corrections[0]).toContain("1 x BURG");
  });
  /** A printer on the venue's default station; returns its id. */
  async function kitchenPrinter(v: PartyVenue): Promise<string> {
    return inTx(v, async (tx) => {
      const [station] = await tx
        .select({ id: kitchenStations.id })
        .from(kitchenStations)
        .where(sql`true`);
      const id = await makePrinter(tx, "Kitchen");
      await attachPrinterToStation(tx, {
        stationId: station!.id,
        printerId: id,
      });
      return id;
    });
  }

  /** The printed lines of each job the printer was sent since `from` jobs, oldest first. */
  async function ticketsSince(printerId: string, from = 0): Promise<string[][]> {
    const jobs = await db
      .select({ payload: printJobs.payload })
      .from(printJobs)
      .where(eq(printJobs.printerId, printerId))
      .orderBy(sql`rowid`);
    return jobs.slice(from).map((job) => printedLines(job.payload));
  }

  it("prints the order line as Pedido N · name for a named party's order", async () => {
    const v = await setupPartyVenue(db);
    const printer = await kitchenPrinter(v);
    const { partyId, tabId } = await seat(v, await v.table("Table 71"));
    await nameParty(v, partyId, "Ana");
    await order(v, tabId, "Burger");
    const { orderNumber } = await billRow(v, tabId);
    const tickets = await ticketsSince(printer);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]!.slice(0, 3)).toEqual(["Cocina", "Table 71", `Pedido ${orderNumber} · Ana`]);
  });

  it("prints the name of the party a bill's party was merged into", async () => {
    await seedPerson(db, { id: OPERATOR });
    const v = await setupPartyVenue(db);
    const printer = await kitchenPrinter(v);
    const table72 = await v.table("Table 72");
    const anna = await seat(v, await v.table("Table 73"));
    await nameParty(v, anna.partyId, "Ana");
    await nextMillisecond();
    const lewis = await seat(v, table72);
    await nameParty(v, lewis.partyId, "Luis");
    await order(v, anna.tabId, "Burger");
    await pay(v, anna.tabId, "12.00");
    const expectedPartyRevision = await revisionOf(v, anna.partyId);
    const expectedOtherPartyRevision = await revisionOf(v, lewis.partyId);
    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, anna.partyId, table72, {
        expectedPartyRevision,
        otherPartyId: lewis.partyId,
        expectedOtherPartyRevision,
        operatorId: OPERATOR,
      }),
    );
    const before = (await ticketsSince(printer)).length;

    await inTx(v, (tx) => reprintOrderTickets(tx, v.cfg, anna.tabId));

    const { orderNumber } = await billRow(v, anna.tabId);
    const tickets = await ticketsSince(printer, before);
    expect(tickets.map((lines) => lines.slice(0, 4))).toEqual([
      [
        expect.stringMatching(
          new RegExp(
            `^\\*\\*\\* ${kitchenTicketWords("es").reprint.replace("{time}", "\\d\\d:\\d\\d")} \\*\\*\\*$`,
          ),
        ),
        "Cocina",
        "Table 72",
        `Pedido ${orderNumber} · Luis`,
      ],
    ]);
  });

  it("prints the bare order number for an unnamed party's order and a counter order", async () => {
    const v = await setupPartyVenue(db);
    const printer = await kitchenPrinter(v);
    const { tabId } = await seat(v, await v.table("Table 74"));
    await order(v, tabId, "Burger");
    const counter = await counterOrder(v, "Burger");
    await inTx(v, async (tx) =>
      fireLines(
        tx,
        v.cfg,
        counter,
        await tx
          .select({
            id: workingOrderLines.id,
            productId: workingOrderLines.productId,
            courseId: workingOrderLines.courseId,
            parentLineId: workingOrderLines.parentLineId,
            note: workingOrderLines.note,
            quantity: workingOrderLines.quantity,
          })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, counter)),
      ),
    );
    const tickets = await ticketsSince(printer);
    expect(tickets.map((lines) => lines.slice(0, 4))).toEqual([
      [
        "Cocina",
        "Table 74",
        String((await billRow(v, tabId)).orderNumber),
        expect.stringMatching(/^\d\d:\d\d$/),
      ],
      [
        "Cocina",
        "",
        String((await billRow(v, counter)).orderNumber),
        expect.stringMatching(/^\d\d:\d\d$/),
      ],
    ]);
  });
});

it("A725 shared kitchen paper lists stations in Spanish alphabetical order", async () => {
  const { cfg } = await setupVenue();
  const text = await asApp(async (tx) => {
    const late = { id: "00000000-0000-4000-8000-000000000001" };
    const early = { id: "00000000-0000-4000-8000-000000000002" };
    await tx.insert(kitchenStations).values([
      { ...late, name: "Ñandú", isDefault: true, colour: "red" },
      { ...early, name: "Naranja", colour: "red" },
    ]);
    const printerId = await makeSharedPrinter(tx, "Shared paper", [late.id, early.id]);
    const lateDish = await makeProduct(tx, "LateDish", { stationId: late.id });
    const earlyDish = await makeProduct(tx, "EarlyDish", { stationId: early.id });
    await fireNewOrder(tx, cfg, [line(lateDish), line(earlyDish)]);
    const jobs = (await printJobsFor(tx)).filter((job) => job.printerId === printerId);
    expect(jobs).toHaveLength(1);
    return decodeTicket(jobs[0]!.payload);
  });
  expect(text.indexOf("EarlyDish")).toBeGreaterThanOrEqual(0);
  expect(text.indexOf("LateDish")).toBeGreaterThanOrEqual(0);
  expect(text.indexOf("EarlyDish")).toBeLessThan(text.indexOf("LateDish"));
});

describe("A773 fire paper: course headings", () => {
  /** Hold a Mains group of a Burger and a Paella at Grill, then fire it; the Grill job's headings. */
  async function firedGrillHeadings(
    beforeFire: (tx: Transaction, v: PartyVenue, tabId: string) => Promise<void> = async () => {},
  ): Promise<string[]> {
    const v = await setupPartyVenue(db);
    const { printerId } = await inTx(v, async (tx) => {
      const { id: grill } = await createStation(tx, { name: "Grill" });
      const mains = await createCourse(tx, { name: "Mains", displayOrder: 2 });
      for (const name of ["Burger", "Paella"]) {
        await routeProductTo(tx, v.productId(name), grill);
        await setProductCourse(tx, v.productId(name), mains.id);
      }
      return { printerId: await makeSharedPrinter(tx, "Grill", [grill]) };
    });
    const { partyId, tabId } = await seatWithNoAllergies(v, await v.table("Table 141"));
    const dish = (name: string) => ({ menuItemId: v.item(name), quantity: "1" });
    const placed = await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, partyId, {
        groups: [{ lines: [dish("Burger"), dish("Paella")], release: "hold" }],
        operatorId: OPERATOR,
        billId: tabId,
      }),
    );
    await inTx(v, (tx) => beforeFire(tx, v, tabId));
    const expectedPartyRevision = await revisionOf(v, partyId);
    await inTx(v, (tx) =>
      fireGroup(tx, v.cfg, partyId, placed.groups[0]!.id, {
        operatorId: OPERATOR,
        submissionId: randomUUID(),
        expectedPartyRevision,
      }),
    );

    const jobs = (await asApp((tx) => printJobsFor(tx))).filter(
      (job) => job.printerId === printerId,
    );
    expect(jobs).toHaveLength(1);
    const word = kitchenTicketWords("es").group;
    return printedLines(jobs[0]!.payload).filter((text) => text.startsWith(word));
  }

  it("A773 fire paper: a waiter's fire prints the group's course on its heading", async () => {
    expect(await firedGrillHeadings()).toEqual([`${kitchenTicketWords("es").group} 1 · MAINS`]);
  });

  it("A773 fire paper: the heading names the course the dish's ticket item holds, not its order line's", async () => {
    const headings = await firedGrillHeadings(async (tx, _v, tabId) => {
      const desserts = await createCourse(tx, { name: "Desserts", displayOrder: 3 });
      await tx
        .update(workingOrderLines)
        .set({ courseId: desserts.id })
        .where(eq(workingOrderLines.workingOrderId, tabId));
    });
    expect(headings).toEqual([`${kitchenTicketWords("es").group} 1 · MAINS`]);
  });

  /** The headings of the Grill printer's jobs enqueued since `seen`, which this call then extends. */
  async function newGrillHeadings(printerId: string, seen: Set<string>): Promise<string[]> {
    const jobs = (await asApp((tx) => printJobsFor(tx))).filter(
      (job) => job.printerId === printerId && !seen.has(job.id),
    );
    for (const job of jobs) seen.add(job.id);
    expect(jobs).toHaveLength(1);
    const word = kitchenTicketWords("es").group;
    return printedLines(jobs[0]!.payload).filter((text) => text.startsWith(word));
  }

  it("A773 fire paper: the heading reads the course as it is when the paper is planned, deactivated or not", async () => {
    const v = await setupPartyVenue(db);
    const { printerId, courseId } = await inTx(v, async (tx) => {
      const { id: grill } = await createStation(tx, { name: "Grill" });
      const mains = await createCourse(tx, { name: "Mains", displayOrder: 2 });
      await routeProductTo(tx, v.productId("Burger"), grill);
      await setProductCourse(tx, v.productId("Burger"), mains.id);
      await setStationPrinting(tx, { printHeldWork: true }, [grill]);
      return { printerId: await makeSharedPrinter(tx, "Grill", [grill]), courseId: mains.id };
    });
    const { partyId, tabId } = await seatWithNoAllergies(v, await v.table("Table 141"));
    const placed = await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, partyId, {
        groups: [{ lines: [{ menuItemId: v.item("Burger"), quantity: "1" }], release: "hold" }],
        operatorId: OPERATOR,
        billId: tabId,
      }),
    );
    const word = kitchenTicketWords("es").group;
    const seen = new Set<string>();
    expect(await newGrillHeadings(printerId, seen)).toEqual([`${word} 1 · MAINS`]);

    await inTx(v, (tx) => updateCourse(tx, courseId, { name: "Main courses" }));
    const expectedPartyRevision = await revisionOf(v, partyId);
    await inTx(v, (tx) =>
      fireGroup(tx, v.cfg, partyId, placed.groups[0]!.id, {
        operatorId: OPERATOR,
        submissionId: randomUUID(),
        expectedPartyRevision,
      }),
    );
    expect(await newGrillHeadings(printerId, seen)).toEqual([`${word} 1 · MAIN COURSES`]);

    await inTx(v, async (tx) => {
      await deleteCourse(tx, courseId);
      await reprintOrderTickets(tx, v.cfg, tabId);
    });
    const kept = await asApp((tx) =>
      tx
        .select({ active: kitchenCourses.active })
        .from(kitchenCourses)
        .where(eq(kitchenCourses.id, courseId)),
    );
    expect(kept).toEqual([{ active: false }]);
    expect(await newGrillHeadings(printerId, seen)).toEqual([`${word} 1 · MAIN COURSES`]);
  });

  it("A773 fire paper: a heading lists its dishes' courses in display order, not name order", async () => {
    const v = await setupPartyVenue(db);
    const printerId = await inTx(v, async (tx) => {
      const { id: grill } = await createStation(tx, { name: "Grill" });
      const starters = await createCourse(tx, { name: "Starters", displayOrder: 1 });
      const mains = await createCourse(tx, { name: "Mains", displayOrder: 2 });
      for (const [name, course] of [
        ["Burger", mains],
        ["Paella", starters],
      ] as const) {
        await routeProductTo(tx, v.productId(name), grill);
        await setProductCourse(tx, v.productId(name), course.id);
      }
      return makeSharedPrinter(tx, "Grill", [grill]);
    });
    const { partyId, tabId } = await seatWithNoAllergies(v, await v.table("Table 141"));
    const dish = (name: string) => ({ menuItemId: v.item(name), quantity: "1" });
    const placed = await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, partyId, {
        groups: [{ lines: [dish("Burger"), dish("Paella")], release: "hold" }],
        operatorId: OPERATOR,
        billId: tabId,
      }),
    );
    const expectedPartyRevision = await revisionOf(v, partyId);
    await inTx(v, (tx) =>
      fireGroup(tx, v.cfg, partyId, placed.groups[0]!.id, {
        operatorId: OPERATOR,
        submissionId: randomUUID(),
        expectedPartyRevision,
      }),
    );
    expect(await newGrillHeadings(printerId, new Set())).toEqual([
      `${kitchenTicketWords("es").group} 1 · STARTERS, MAINS`,
    ]);
  });

  it("A773 fire paper: reordering held groups keeps each heading's number and course", async () => {
    const v = await setupPartyVenue(db);
    const printerId = await inTx(v, async (tx) => {
      const { id: grill } = await createStation(tx, { name: "Grill" });
      const mains = await createCourse(tx, { name: "Mains", displayOrder: 2 });
      const desserts = await createCourse(tx, { name: "Desserts", displayOrder: 3 });
      for (const [name, course] of [
        ["Burger", mains],
        ["Flan", desserts],
      ] as const) {
        await routeProductTo(tx, v.productId(name), grill);
        await setProductCourse(tx, v.productId(name), course.id);
      }
      return makeSharedPrinter(tx, "Grill", [grill]);
    });
    const { partyId, tabId } = await seatWithNoAllergies(v, await v.table("Table 141"));
    const dish = (name: string) => ({ menuItemId: v.item(name), quantity: "1" });
    const placed = await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, partyId, {
        groups: [
          { lines: [dish("Burger")], release: "hold" },
          { lines: [dish("Flan")], release: "hold" },
        ],
        operatorId: OPERATOR,
        billId: tabId,
      }),
    );
    const [mainsGroup, dessertsGroup] = placed.groups.map((group) => group.id);
    const seen = new Set<string>();

    const reorderRevision = await revisionOf(v, partyId);
    await inTx(v, (tx) =>
      reorderHeldGroups(tx, partyId, [dessertsGroup!, mainsGroup!], {
        operatorId: OPERATOR,
        submissionId: randomUUID(),
        expectedPartyRevision: reorderRevision,
      }),
    );
    const expectedPartyRevision = await revisionOf(v, partyId);
    await inTx(v, (tx) =>
      fireGroup(tx, v.cfg, partyId, dessertsGroup!, {
        operatorId: OPERATOR,
        submissionId: randomUUID(),
        expectedPartyRevision,
      }),
    );
    expect(await newGrillHeadings(printerId, seen)).toEqual([
      `${kitchenTicketWords("es").group} 2 · DESSERTS`,
    ]);

    const mainsRevision = await revisionOf(v, partyId);
    await inTx(v, (tx) =>
      fireGroup(tx, v.cfg, partyId, mainsGroup!, {
        operatorId: OPERATOR,
        submissionId: randomUUID(),
        expectedPartyRevision: mainsRevision,
      }),
    );
    expect(await newGrillHeadings(printerId, seen)).toEqual([
      `${kitchenTicketWords("es").group} 1 · MAINS`,
    ]);
  });
});
