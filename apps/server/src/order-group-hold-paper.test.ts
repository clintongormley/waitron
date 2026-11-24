import {
  kitchenPrintJobs,
  printJobs,
  products,
  printers,
  orderGroupHoldStations,
  ticketItems,
} from "@waitron/db";
import { seedKitchenStation } from "@waitron/db/testing/seed.js";
import { createProduct, createOptionList, writeProductModifiers } from "@waitron/menu";
import { createPrinter } from "@waitron/printing";
import { listStationNotices, setRoutingCell } from "@waitron/venue-service";
import { sql, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import { fireHeldLine } from "./order-group-release.js";
import { attachPrinterToStation } from "./station-printers.js";
import { cancelItemForTest, cancelLine } from "./testing/cancel-line.js";
import { printedLines } from "./testing/decode-ticket.js";
import {
  inTx,
  type Venue,
  type Seated,
  billHead,
  printed,
  ticketLines,
  db,
  type Dish,
  linesIn,
  seated,
  submit,
  line,
  LOCALE,
  setupVenue,
  specExample,
  move,
  changeLine,
  MIA,
  fire,
  DISHES,
  groupRow,
  splitToCheck,
  groupsOf,
  saveWhole,
  keptLines,
  submitGrouped,
  args,
  revisionOf,
} from "./testing/order-groups.test-support.js";
import { setStationPrinting } from "./testing/station-printing.js";
import { offerProducts } from "./testing/zone-offers.js";

describe("advance HOLD tickets (Task 6)", () => {
  const printHeldWork = (on: boolean) =>
    inTx((tx) => setStationPrinting(tx, { printHeldWork: on }));

  /** What every ticket and slip for the party's tab prints under its mark. */
  const head = (v: Venue, s: Seated) => billHead(v, s, s.tabId);

  /** The jobs printed since `from`, each as its lines. */
  async function printedSince(v: Venue, from: number): Promise<string[][]> {
    return (await printed(v)).slice(from).map(ticketLines);
  }

  async function noticesAt(v: Venue) {
    return (await inTx((tx) => listStationNotices(tx, v.stationId))).map((notice) => ({
      kind: notice.kind,
      lineName: notice.lineName,
      quantity: notice.quantity,
      direction: notice.direction,
    }));
  }

  /** The print jobs `kitchen_print_jobs` links to a bill: the ones a printing problem can name. */
  async function linkedJobs(): Promise<string[]> {
    const rows = await db
      .select({ printJobId: kitchenPrintJobs.printJobId })
      .from(kitchenPrintJobs)
      .orderBy(sql`${kitchenPrintJobs}.rowid`);
    return rows.map((row) => row.printJobId);
  }

  async function jobIds(v: Venue): Promise<string[]> {
    const rows = await db
      .select({ id: printJobs.id })
      .from(printJobs)
      .where(eq(printJobs.printerId, v.printerId))
      .orderBy(sql`rowid`);
    return rows.map((row) => row.id);
  }

  const lineOf = async (s: Seated, groupId: string, dish: Dish, v: Venue) =>
    (await linesIn(s.partyId, groupId)).find((row) => row.productId === v.productId[dish])!;

  async function noticesWithNotes(v: Venue) {
    return (await inTx((tx) => listStationNotices(tx, v.stationId))).map((notice) => ({
      kind: notice.kind,
      quantity: notice.quantity,
      direction: notice.direction,
      note: notice.note,
    }));
  }

  /** A held group of two rare Steaks on a fresh party, and the Steak's line. */
  async function rareSteaks(v: Venue) {
    const s = await seated(v);
    const [group] = (
      await submit(v, s.partyId, [
        { release: "hold", lines: [{ ...line(v, "steak", "2"), note: "rare" }] },
      ])
    ).groups;
    const [steak] = await linesIn(s.partyId, group!.id);
    return { s, group: group!.id, steak: steak! };
  }

  /**
   * A dish that must be cooked one of two ways, published to the venue's tables. Its three names
   * differ, as do each way's, so paper reading a staff or customer name shows the wrong text.
   */
  async function tunaWithDoneness(v: Venue) {
    return inTx(async (tx) => {
      const [steak] = await tx
        .select({ categoryId: products.categoryId })
        .from(products)
        .where(eq(products.id, v.productId.steak));
      const tuna = await createProduct(tx, {
        ...steak!,
        name: "Tuna",
        customerName: { en: "Seared tuna" },
        kitchenName: "K-TUNA",
        pricingUnit: "each",
        unitPrice: "20.00",
        vatClass: "general",
      });
      const list = await createOptionList(
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
      await writeProductModifiers(tx, tuna.id, [{ kind: "options", id: list.id }]);
      const offers = await offerProducts(tx, { zone: "tables", productIds: [tuna.id] });
      const [rare, well] = list.labels.map((label) => ({ listId: list.id, labelId: label.id }));
      return { offer: offers.offerFor(tuna.id), rare: rare!, well: well! };
    });
  }

  it("setting off (the default): holding prints nothing, and firing prints the group's current contents, edits included", async () => {
    const v = await setupVenue();
    const s = await specExample(v, "grouped");
    expect(await printed(v)).toHaveLength(2);
    const steak = await lineOf(s, s.mains, "steak", v);
    const fish = await lineOf(s, s.mains, "fish", v);

    await move(v, s.partyId, [{ lineId: steak.id, quantity: "1" }], { groupId: s.desserts });
    await changeLine(v, s.tabId, fish.lineNo, { portionLineNos: [], quantity: "2" }, MIA);
    expect(await printed(v)).toHaveLength(2);
    expect(await noticesAt(v)).toEqual([]);

    await fire(v, s.partyId, s.mains);

    expect(await printedSince(v, 2)).toEqual([
      [
        ...(await head(v, s)),
        "GROUP 4 · MAINS",
        `1 x ${DISHES.steak.kitchen}`,
        `2 x ${DISHES.fish.kitchen}`,
      ],
    ]);
    for (const group of [s.warm, s.mains, s.desserts]) {
      expect((await groupRow(group)).holdPrintedAt).toBeNull();
    }
  });

  describe("setting on", () => {
    it("sends held quantity edits and Cancel item corrections to a second printer on the station", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const secondPrinter = await inTx(async (tx) => {
        const printer = await createPrinter(tx, {
          name: "Held second",
          transport: "cloud_poll",
          pollId: `poll-${randomUUID()}`,
        });
        await attachPrinterToStation(tx, {
          stationId: v.stationId,
          printerId: printer.id,
        });
        return printer.id;
      });
      const s = await specExample(v);
      const secondPaper = async () =>
        (
          await db
            .select({ payload: printJobs.payload })
            .from(printJobs)
            .where(eq(printJobs.printerId, secondPrinter))
        ).map((job) => printedLines(job.payload).join(" "));
      const before = (await secondPaper()).length;
      const steak = await lineOf(s, s.mains, "steak", v);
      const fish = await lineOf(s, s.mains, "fish", v);
      // Steak ×2 is two portions of one: raise the first.
      await changeLine(v, s.tabId, steak.lineNo, { portionLineNos: [], quantity: "2" }, MIA);
      const changed = (await secondPaper()).slice(before);
      expect(changed).toHaveLength(1);
      expect(changed[0]).toContain("HOLD CHANGED");
      expect(changed[0]).toContain("K-STEAK");
      await inTx((tx) => cancelItemForTest(tx, v.cfg, s.tabId, fish.lineNo, undefined, MIA));
      const cancelled = (await secondPaper()).slice(before + changed.length);
      expect(cancelled).toHaveLength(1);
      expect(cancelled[0]).toContain("HOLD CANCELLED");
      expect(cancelled[0]).toContain("K-FISH");
    });
    it("holding the mains prints a ticket headed HOLD listing 2 x Steak and 1 x Fish, linked so a printing problem can name it", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v);

      const jobs = await printedSince(v, 0);
      expect(jobs).toHaveLength(5);
      expect(jobs[3]).toEqual([
        "*** HOLD ***",
        ...(await head(v, s)),
        "GROUP 4 · MAINS",
        `2 x ${DISHES.steak.kitchen}`,
        `1 x ${DISHES.fish.kitchen}`,
      ]);
      expect(jobs.map((job) => job[0])).toEqual([
        expect.not.stringContaining("***"),
        expect.not.stringContaining("***"),
        "*** HOLD ***",
        "*** HOLD ***",
        "*** HOLD ***",
      ]);
      expect(jobs[4]!.slice(5)).toEqual(["GROUP 5 · DESSERTS", `2 x ${DISHES.flan.kitchen}`]);
      expect(await linkedJobs()).toEqual(await jobIds(v));
      expect((await groupRow(s.mains)).holdPrintedAt).not.toBeNull();
      expect((await groupRow(s.drinks)).holdPrintedAt).toBeNull();
      expect((await groupRow(s.cold)).holdPrintedAt).toBeNull();
    });

    it("moves a Steak, removes the Fish and fires the mains: -1/+1 corrections, a HOLD cancellation, then one FIRE slip", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v, "grouped");
      const header = await head(v, s);
      const steak = await lineOf(s, s.mains, "steak", v);
      const fish = await lineOf(s, s.mains, "fish", v);

      await move(v, s.partyId, [{ lineId: steak.id, quantity: "1" }], { groupId: s.desserts });

      expect(await printedSince(v, 5)).toEqual([
        ["*** HOLD CHANGED ***", ...header, "GROUP 4 · MAINS", `-1 x ${DISHES.steak.kitchen}`],
        ["*** HOLD CHANGED ***", ...header, "GROUP 5 · MAINS", `+1 x ${DISHES.steak.kitchen}`],
      ]);
      expect(await noticesAt(v)).toEqual([
        {
          kind: "changed",
          lineName: DISHES.steak.kitchen,
          quantity: "1.000",
          direction: "removed",
        },
        { kind: "changed", lineName: DISHES.steak.kitchen, quantity: "1.000", direction: "added" },
      ]);

      await inTx((tx) => cancelLine(tx, v.cfg, s.tabId, fish.lineNo, undefined, MIA));

      expect(await printedSince(v, 7)).toEqual([
        ["*** HOLD CANCELLED ***", ...header, "GROUP 4 · MAINS", `1 x ${DISHES.fish.kitchen}`],
      ]);
      expect((await noticesAt(v)).at(-1)).toEqual({
        kind: "void",
        lineName: DISHES.fish.kitchen,
        quantity: "1.000",
        direction: null,
      });
      const linkedBefore = await linkedJobs();

      await fire(v, s.partyId, s.mains);

      expect(await printedSince(v, 8)).toEqual([
        ["*** FIRE ***", ...header, "GROUP 4 · MAINS", `1 x ${DISHES.steak.kitchen}`],
      ]);
      expect(await linkedJobs()).toEqual([...linkedBefore, (await jobIds(v)).at(-1)]);
      const ids = await jobIds(v);
      expect(linkedBefore).toEqual(ids.slice(0, 8));
      const marked = await db
        .select({ id: kitchenPrintJobs.printJobId })
        .from(kitchenPrintJobs)
        .where(eq(kitchenPrintJobs.correctionSlip, true))
        .orderBy(sql`${kitchenPrintJobs}.rowid`);
      expect(marked.map(({ id }) => id)).toEqual(ids.slice(5, 8));
    });

    it("prints a FIRE slip for a waiter-released group", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v);

      await fire(v, s.partyId, s.mains, { operatorId: MIA });

      expect(await printedSince(v, 5)).toEqual([
        [
          "*** FIRE ***",
          ...(await head(v, s)),
          "GROUP 4 · MAINS",
          `2 x ${DISHES.steak.kitchen}`,
          `1 x ${DISHES.fish.kitchen}`,
        ],
      ]);
    });

    it("prints a MOVED slip listing the Steak under HOLD when one of the printed mains is split onto a check, then one FIRE slip from each bill for its own dishes", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v, "grouped");
      const steak = await lineOf(s, s.mains, "steak", v);
      const holdJob = (await jobIds(v))[3]!;
      expect((await printedSince(v, 3))[0]).toEqual([
        "*** HOLD ***",
        ...(await head(v, s)),
        "GROUP 4 · MAINS",
        `2 x ${DISHES.steak.kitchen}`,
        `1 x ${DISHES.fish.kitchen}`,
      ]);

      const checkId = await splitToCheck(
        v,
        s,
        [{ lineNo: steak.lineNo, quantity: "1" }],
        undefined,
        MIA,
      );

      const [station, table, tabNumber, at] = await head(v, s);
      const checkNumber = (await billHead(v, s, checkId))[2];
      expect(await printedSince(v, 5)).toEqual([
        [
          `*** ${kitchenTicketWords("en").moved} ***`,
          station,
          `${kitchenTicketWords("en").order} ${tabNumber} -> ${checkNumber}`,
          `${kitchenTicketWords("en").fromPlace}${table}`,
          `${kitchenTicketWords("en").toPlace}${table}`,
          at,
          "HOLD",
          "GROUP 4 · MAINS",
          `1 x ${DISHES.steak.kitchen}`,
        ],
      ]);
      expect(await noticesAt(v)).toEqual([
        { kind: "moved", lineName: DISHES.steak.kitchen, quantity: "1.000", direction: null },
      ]);

      await fire(v, s.partyId, s.mains);

      expect(await printedSince(v, 6)).toEqual([
        [
          "*** FIRE ***",
          ...(await head(v, s)),
          "GROUP 4 · MAINS",
          `1 x ${DISHES.steak.kitchen}`,
          `1 x ${DISHES.fish.kitchen}`,
        ],
        [
          "*** FIRE ***",
          ...(await billHead(v, s, checkId)),
          "GROUP 4 · MAINS",
          `1 x ${DISHES.steak.kitchen}`,
        ],
      ]);
      const [tabSlip, checkSlip] = (await jobIds(v)).slice(6);
      const linksOf = async (billId: string) =>
        (
          await db
            .select({ printJobId: kitchenPrintJobs.printJobId })
            .from(kitchenPrintJobs)
            .where(eq(kitchenPrintJobs.workingOrderId, billId))
            .orderBy(sql`${kitchenPrintJobs}.rowid`)
        ).map((row) => row.printJobId);
      // A printing problem on the check can name the HOLD ticket its Steak was announced on.
      expect(await linksOf(checkId)).toEqual([holdJob, checkSlip]);
      expect(await linksOf(s.tabId)).toEqual([...(await jobIds(v)).slice(0, 5), tabSlip]);
    });

    it("prints +1 for a Steak joined to the printed mains, with an added notice", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v);

      await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak")] }], {
        joinGroupId: s.mains,
      });

      expect(await printedSince(v, 5)).toEqual([
        [
          "*** HOLD CHANGED ***",
          ...(await head(v, s)),
          "GROUP 4 · MAINS",
          `+1 x ${DISHES.steak.kitchen}`,
        ],
      ]);
      expect(await noticesAt(v)).toEqual([
        { kind: "changed", lineName: DISHES.steak.kitchen, quantity: "1.000", direction: "added" },
      ]);
    });

    it("prints a HOLD ticket for the new group a move makes, and -1 for the printed group it left", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v, "grouped");
      const header = await head(v, s);
      const steak = await lineOf(s, s.mains, "steak", v);

      await move(v, s.partyId, [{ lineId: steak.id, quantity: "1" }], "new");

      const created = (await groupsOf(s.partyId)).groups.at(-1)!;
      expect(created.position).toBe(6);
      expect(await printedSince(v, 5)).toEqual([
        ["*** HOLD CHANGED ***", ...header, "GROUP 4 · MAINS", `-1 x ${DISHES.steak.kitchen}`],
        ["*** HOLD ***", ...header, "GROUP 6 · MAINS", `1 x ${DISHES.steak.kitchen}`],
      ]);
      expect((await groupRow(created.id)).holdPrintedAt).not.toBeNull();
      expect((await noticesAt(v)).map((notice) => notice.direction)).toEqual(["removed"]);
    });

    it("prints -1 and +1 for a whole line moved between printed groups", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v);
      const header = await head(v, s);
      const fish = await lineOf(s, s.mains, "fish", v);

      await move(v, s.partyId, [{ lineId: fish.id, quantity: "1" }], { groupId: s.warm });

      expect(await printedSince(v, 5)).toEqual([
        ["*** HOLD CHANGED ***", ...header, "GROUP 4 · MAINS", `-1 x ${DISHES.fish.kitchen}`],
        ["*** HOLD CHANGED ***", ...header, "GROUP 3 · MAINS", `+1 x ${DISHES.fish.kitchen}`],
      ]);
    });

    it("prints nothing for part of a line moved within its own printed group", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v, "grouped");
      const steak = await lineOf(s, s.mains, "steak", v);

      await move(v, s.partyId, [{ lineId: steak.id, quantity: "1" }], { groupId: s.mains });

      expect(await linesIn(s.partyId, s.mains)).toHaveLength(3);
      expect(await printedSince(v, 5)).toEqual([]);
      expect(await noticesAt(v)).toEqual([]);
    });

    // An edit that is not a quantity alone takes the dish away as it read and gives it back as
    // it now reads.
    it("prints a changed note as -N of the dish as it read, then +N as it now reads", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const { s, steak } = await rareSteaks(v);
      const header = await head(v, s);

      await changeLine(v, s.tabId, steak.lineNo, { portionLineNos: [], note: "no pepper" }, MIA);

      expect(await printedSince(v, 1)).toEqual([
        [
          "*** HOLD CHANGED ***",
          ...header,
          "GROUP 1 · MAINS",
          `-1 x ${DISHES.steak.kitchen}`,
          "  * rare",
        ],
        [
          "*** HOLD CHANGED ***",
          ...header,
          "GROUP 1 · MAINS",
          `+1 x ${DISHES.steak.kitchen}`,
          "  * no pepper",
        ],
      ]);
      expect(await noticesWithNotes(v)).toEqual([
        { kind: "changed", quantity: "1.000", direction: "removed", note: "rare" },
        { kind: "changed", quantity: "1.000", direction: "added", note: "no pepper" },
      ]);
    });

    it("prints a quantity and a note changed together as the old dish taken away and the new one given", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const { s, steak } = await rareSteaks(v);
      const header = await head(v, s);

      await changeLine(
        v,
        s.tabId,
        steak.lineNo,
        { portionLineNos: [], quantity: "1", note: "well done" },
        MIA,
      );

      expect(await printedSince(v, 1)).toEqual([
        [
          "*** HOLD CHANGED ***",
          ...header,
          "GROUP 1 · MAINS",
          `-1 x ${DISHES.steak.kitchen}`,
          "  * rare",
        ],
        [
          "*** HOLD CHANGED ***",
          ...header,
          "GROUP 1 · MAINS",
          `+1 x ${DISHES.steak.kitchen}`,
          "  * well done",
        ],
      ]);
      expect(await noticesWithNotes(v)).toEqual([
        { kind: "changed", quantity: "1.000", direction: "removed", note: "rare" },
        { kind: "changed", quantity: "1.000", direction: "added", note: "well done" },
      ]);
    });

    it("A803 portions: raising a held portion to 2 with a new note prints the old dish taken away, then the edited and the added portion given apart", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const { s, steak } = await rareSteaks(v);
      const header = await head(v, s);

      await changeLine(
        v,
        s.tabId,
        steak.lineNo,
        { portionLineNos: [], quantity: "2", note: "well done" },
        MIA,
      );

      const given = [
        "*** HOLD CHANGED ***",
        ...header,
        "GROUP 1 · MAINS",
        `+1 x ${DISHES.steak.kitchen}`,
        "  * well done",
      ];
      expect(await printedSince(v, 1)).toEqual([
        [
          "*** HOLD CHANGED ***",
          ...header,
          "GROUP 1 · MAINS",
          `-1 x ${DISHES.steak.kitchen}`,
          "  * rare",
        ],
        given,
        given,
      ]);
      expect(await noticesWithNotes(v)).toEqual([
        { kind: "changed", quantity: "1.000", direction: "removed", note: "rare" },
        { kind: "changed", quantity: "1.000", direction: "added", note: "well done" },
        { kind: "changed", quantity: "1.000", direction: "added", note: "well done" },
      ]);
    });

    it("prints an added extra as the dish without it taken away and the dish with it given", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const { s, steak } = await rareSteaks(v);
      const header = await head(v, s);
      const sauce = [
        { listId: v.extrasListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] },
      ];

      await changeLine(v, s.tabId, steak.lineNo, { portionLineNos: [], extras: sauce }, MIA);

      expect(await printedSince(v, 1)).toEqual([
        [
          "*** HOLD CHANGED ***",
          ...header,
          "GROUP 1 · MAINS",
          `-1 x ${DISHES.steak.kitchen}`,
          "  * rare",
        ],
        [
          "*** HOLD CHANGED ***",
          ...header,
          "GROUP 1 · MAINS",
          `+1 x ${DISHES.steak.kitchen}`,
          `  + ${DISHES.sauce.kitchen}`,
          "  * rare",
        ],
      ]);
      expect(await noticesWithNotes(v)).toEqual([
        { kind: "changed", quantity: "1.000", direction: "removed", note: "rare" },
        { kind: "changed", quantity: "1.000", direction: "added", note: "rare" },
      ]);
    });

    it("prints a changed options answer as the dish cooked the old way taken away and the new way given", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const tuna = await tunaWithDoneness(v);
      const s = await seated(v);
      const [group] = (
        await submit(v, s.partyId, [
          {
            release: "hold",
            lines: [{ menuItemId: tuna.offer, quantity: "1", options: [tuna.rare] }],
          },
        ])
      ).groups;
      const [dish] = await linesIn(s.partyId, group!.id);
      const header = await head(v, s);

      await changeLine(v, s.tabId, dish!.lineNo, { portionLineNos: [], options: [tuna.well] }, MIA);

      expect(await printedSince(v, 1)).toEqual([
        ["*** HOLD CHANGED ***", ...header, "GROUP 1", "-1 x K-TUNA", "  + K-DONE: K-RARE"],
        ["*** HOLD CHANGED ***", ...header, "GROUP 1", "+1 x K-TUNA", "  + K-DONE: K-WELL"],
      ]);
      expect((await noticesWithNotes(v)).map((notice) => notice.direction)).toEqual([
        "removed",
        "added",
      ]);
    });

    it("prints nothing for the same edits on a group whose HOLD ticket was never queued", async () => {
      const v = await setupVenue();
      const tuna = await tunaWithDoneness(v);
      const { s, steak } = await rareSteaks(v);
      const [group] = (
        await submit(v, s.partyId, [
          {
            release: "hold",
            lines: [{ menuItemId: tuna.offer, quantity: "1", options: [tuna.rare] }],
          },
        ])
      ).groups;
      const [dish] = await linesIn(s.partyId, group!.id);
      await printHeldWork(true);

      await changeLine(v, s.tabId, steak.lineNo, { portionLineNos: [], note: "no pepper" }, MIA);
      await changeLine(
        v,
        s.tabId,
        steak.lineNo,
        { portionLineNos: [], quantity: "1", note: "well done" },
        MIA,
      );
      await changeLine(
        v,
        s.tabId,
        steak.lineNo,
        {
          portionLineNos: [],
          extras: [
            { listId: v.extrasListId, picks: [{ productId: v.productId.sauce, quantity: 1 }] },
          ],
        },
        MIA,
      );
      await changeLine(v, s.tabId, dish!.lineNo, { portionLineNos: [], options: [tuna.well] }, MIA);

      expect(await printed(v)).toEqual([]);
      expect(await noticesWithNotes(v)).toEqual([]);
    });

    it("prints an addition and a cancellation for a held Steak's quantity raised by Change dish and lowered by Cancel item", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v, "grouped");
      const header = await head(v, s);
      const steak = await lineOf(s, s.mains, "steak", v);

      await changeLine(v, s.tabId, steak.lineNo, { portionLineNos: [], quantity: "3" }, MIA);
      await inTx((tx) => cancelItemForTest(tx, v.cfg, s.tabId, steak.lineNo, "2", MIA));

      expect(await printedSince(v, 5)).toEqual([
        ["*** HOLD CHANGED ***", ...header, "GROUP 4 · MAINS", `+1 x ${DISHES.steak.kitchen}`],
        ["*** HOLD CANCELLED ***", ...header, "GROUP 4 · MAINS", `2 x ${DISHES.steak.kitchen}`],
      ]);
      expect(await noticesAt(v)).toEqual([
        { kind: "changed", lineName: DISHES.steak.kitchen, quantity: "1.000", direction: "added" },
        {
          kind: "void",
          lineName: DISHES.steak.kitchen,
          quantity: "2.000",
          direction: null,
        },
      ]);
    });

    it("prints a HOLD cancellation for a held line Cancel item removes", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v);
      const fish = await lineOf(s, s.mains, "fish", v);

      await inTx((tx) => cancelItemForTest(tx, v.cfg, s.tabId, fish.lineNo, undefined, MIA));

      expect(await printedSince(v, 5)).toEqual([
        [
          "*** HOLD CANCELLED ***",
          ...(await head(v, s)),
          "GROUP 4 · MAINS",
          `1 x ${DISHES.fish.kitchen}`,
        ],
      ]);
      expect(await noticesAt(v)).toEqual([
        { kind: "void", lineName: DISHES.fish.kitchen, quantity: "1.000", direction: null },
      ]);
    });

    it("prints a HOLD cancellation for the part of a held line voided, and for a void that empties its group", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v, "grouped");
      const header = await head(v, s);
      const steak = await lineOf(s, s.mains, "steak", v);
      const flan = await lineOf(s, s.desserts, "flan", v);

      await inTx((tx) => cancelLine(tx, v.cfg, s.tabId, steak.lineNo, "1", MIA));
      await inTx((tx) => cancelLine(tx, v.cfg, s.tabId, flan.lineNo, undefined, MIA));

      expect(await printedSince(v, 5)).toEqual([
        ["*** HOLD CANCELLED ***", ...header, "GROUP 4 · MAINS", `1 x ${DISHES.steak.kitchen}`],
        ["*** HOLD CANCELLED ***", ...header, "GROUP 5 · DESSERTS", `2 x ${DISHES.flan.kitchen}`],
      ]);
      expect((await groupRow(s.desserts)).state).toBe("removed");
      expect((await noticesAt(v)).map((notice) => notice.kind)).toEqual(["void", "void"]);
    });

    it("prints a HOLD ticket for the held group an edit makes on a party with nothing sent", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await seated(v);
      await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak")] }]);
      expect(await printed(v)).toHaveLength(1);

      await saveWhole(v, s.tabId, [...(await keptLines(v, s.tabId)), line(v, "fish")], MIA);

      const created = (await groupsOf(s.partyId)).groups.at(-1)!;
      expect(created.summary).toBe("1 × Fish");
      expect(await printedSince(v, 1)).toEqual([
        ["*** HOLD ***", ...(await head(v, s)), "GROUP 2 · MAINS", `1 x ${DISHES.fish.kitchen}`],
      ]);
      expect((await groupRow(created.id)).holdPrintedAt).not.toBeNull();
    });

    it("records no HOLD ticket where no active printer took one, and the group fires as before", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      await db.update(printers).set({ active: false }).where(eq(printers.id, v.printerId));
      const s = await seated(v);
      const [held] = (await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "fish")] }]))
        .groups;
      expect((await groupRow(held!.id)).holdPrintedAt).toBeNull();
      await db.update(printers).set({ active: true }).where(eq(printers.id, v.printerId));

      await fire(v, s.partyId, held!.id);

      expect(await printedSince(v, 0)).toEqual([
        [...(await head(v, s)), "GROUP 1 · MAINS", `1 x ${DISHES.fish.kitchen}`],
      ]);
    });
  });

  describe("a group held before the setting was turned on", () => {
    it("fires with a normal ticket, and its edits print nothing", async () => {
      const v = await setupVenue();
      const s = await specExample(v);
      await printHeldWork(true);
      // Steak ×2 is two portions: move the first, then raise the one left in the mains.
      const [steak, left] = (await linesIn(s.partyId, s.mains)).filter(
        (row) => row.productId === v.productId.steak,
      );

      await move(v, s.partyId, [{ lineId: steak!.id, quantity: "1" }], { groupId: s.desserts });
      await changeLine(v, s.tabId, left!.lineNo, { portionLineNos: [], quantity: "2" }, MIA);
      await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "fish")] }], {
        joinGroupId: s.mains,
      });
      expect(await printed(v)).toHaveLength(2);
      expect(await noticesAt(v)).toEqual([]);

      await fire(v, s.partyId, s.mains);

      expect(await printedSince(v, 2)).toEqual([
        [
          ...(await head(v, s)),
          "GROUP 4 · MAINS",
          `2 x ${DISHES.steak.kitchen}`,
          `2 x ${DISHES.fish.kitchen}`,
        ],
      ]);
    });

    it("is the record, not the setting: a group whose HOLD ticket was queued still fires with a FIRE slip once the setting is off", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v);
      await printHeldWork(false);
      const fish = await lineOf(s, s.mains, "fish", v);

      await inTx((tx) => cancelLine(tx, v.cfg, s.tabId, fish.lineNo, undefined, MIA));
      await fire(v, s.partyId, s.mains);

      expect((await printedSince(v, 5)).map((job) => job[0])).toEqual([
        "*** HOLD CANCELLED ***",
        "*** FIRE ***",
      ]);
    });
  });

  describe("each station's own held printing", () => {
    /**
     * Kitchen (the venue's station, cooking the Steak) prints held work and Bar (its own printer,
     * making the Fish) does not, as `kitchenOn`/`barOn` say; every other station is off.
     */
    async function twoStations({ kitchenOn, barOn }: { kitchenOn: boolean; barOn: boolean }) {
      const v = await setupVenue();
      const barId = await seedKitchenStation(db, {
        name: "Bar",
        isDefault: false,
      });
      const barPrinter = await inTx(async (tx) => {
        await setRoutingCell(
          tx,
          { row: { kind: "product", productId: v.productId.fish }, zoneId: null },
          { kind: "station", stationId: barId },
        );
        const printer = await createPrinter(tx, {
          name: "Barra",
          transport: "cloud_poll",
          pollId: `poll-${randomUUID()}`,
        });
        await attachPrinterToStation(tx, {
          stationId: barId,
          printerId: printer.id,
        });
        await setStationPrinting(tx, { printHeldWork: true });
        await setStationPrinting(tx, { printHeldWork: kitchenOn }, [v.stationId]);
        await setStationPrinting(tx, { printHeldWork: barOn }, [barId]);
        return printer.id;
      });
      const s = await seated(v);
      const [group] = (
        await submit(v, s.partyId, [
          { release: "hold", lines: [line(v, "steak"), line(v, "fish")] },
        ])
      ).groups;
      return { v, s, barId, barPrinter, group: group!.id };
    }

    async function paperAt(printerId: string): Promise<string[][]> {
      const jobs = await db
        .select({ payload: printJobs.payload })
        .from(printJobs)
        .where(eq(printJobs.printerId, printerId))
        .orderBy(sql`rowid`);
      return jobs.map((job) => ticketLines(printedLines(job.payload).join("\n")));
    }

    async function recorded(groupId: string) {
      return db
        .select({
          groupId: orderGroupHoldStations.groupId,
          stationId: orderGroupHoldStations.stationId,
        })
        .from(orderGroupHoldStations)
        .where(eq(orderGroupHoldStations.groupId, groupId));
    }

    const setHeld = (on: boolean, stationId: string) =>
      inTx((tx) => setStationPrinting(tx, { printHeldWork: on }, [stationId]));

    it("a held group's HOLD ticket prints only at the stations that print held work, and records them", async () => {
      const { v, s, barPrinter, group } = await twoStations({ kitchenOn: true, barOn: false });

      expect(await printedSince(v, 0)).toEqual([
        ["*** HOLD ***", ...(await head(v, s)), "GROUP 1 · MAINS", `1 x ${DISHES.steak.kitchen}`],
      ]);
      expect(await paperAt(barPrinter)).toEqual([]);
      expect(await recorded(group)).toEqual([{ groupId: group, stationId: v.stationId }]);
      expect((await groupRow(group)).holdPrintedAt).not.toBeNull();
    });

    it("takes a moved portion off HOLD paper when its destination group has none", async () => {
      const v = await setupVenue();
      const s = await seated(v);
      await setHeld(true, v.stationId);
      const [source] = (
        await submitGrouped(v, s, [{ release: "hold", lines: [line(v, "steak", "2")] }])
      ).groups;
      await setHeld(false, v.stationId);
      const [destination] = (
        await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "fish")] }])
      ).groups;
      const original = await lineOf(s, source!.id, "steak", v);
      expect(original.quantity).toBe(2000);

      await move(v, s.partyId, [{ lineId: original.id, quantity: "1" }], {
        groupId: destination!.id,
      });

      const portion = await lineOf(s, destination!.id, "steak", v);
      expect(portion.id).not.toBe(original.id);
      const tickets = await db
        .select()
        .from(ticketItems)
        .where(inArray(ticketItems.workingOrderLineId, [original.id, portion.id]));
      expect(tickets.find((ticket) => ticket.workingOrderLineId === original.id)).toMatchObject({
        holdPaperQueued: true,
      });
      expect(tickets.find((ticket) => ticket.workingOrderLineId === portion.id)).toMatchObject({
        holdPaperQueued: false,
      });
    });

    it("with no station printing held work, nothing prints and nothing is recorded", async () => {
      const { v, barPrinter, group } = await twoStations({ kitchenOn: false, barOn: false });

      expect(await printed(v)).toEqual([]);
      expect(await paperAt(barPrinter)).toEqual([]);
      expect(await recorded(group)).toEqual([]);
      expect((await groupRow(group)).holdPrintedAt).toBeNull();
    });

    it("firing marks FIRE only on the paper of a station that had the HOLD ticket", async () => {
      const { v, s, barPrinter, group } = await twoStations({ kitchenOn: true, barOn: false });

      await fire(v, s.partyId, group);

      const kitchen = await printedSince(v, 1);
      expect(kitchen).toHaveLength(1);
      expect(kitchen[0]![0]).toBe("*** FIRE ***");
      expect(kitchen[0]).toContain(`1 x ${DISHES.steak.kitchen}`);
      const bar = await paperAt(barPrinter);
      expect(bar).toHaveLength(1);
      expect(bar[0]![0]).toBe("Bar");
      expect(bar[0]).toContain(`1 x ${DISHES.fish.kitchen}`);
      expect(bar[0]!.join("\n")).not.toContain("***");
    });

    it("a station switched off after its HOLD ticket printed is still fired marked FIRE", async () => {
      const { v, s, group } = await twoStations({ kitchenOn: true, barOn: false });
      await setHeld(false, v.stationId);

      await fire(v, s.partyId, group);

      expect((await printedSince(v, 1)).map((job) => job[0])).toEqual(["*** FIRE ***"]);
    });

    it("a station switched on after the group was held is fired with an ordinary ticket", async () => {
      const { v, s, barId, barPrinter, group } = await twoStations({
        kitchenOn: true,
        barOn: false,
      });
      await setHeld(true, barId);

      await fire(v, s.partyId, group);

      const bar = await paperAt(barPrinter);
      expect(bar).toHaveLength(1);
      expect(bar[0]![0]).toBe("Bar");
      expect(bar[0]!.join("\n")).not.toContain("***");
      expect((await printedSince(v, 1)).map((job) => job[0])).toEqual(["*** FIRE ***"]);
    });

    it("Fire now on one held dish marks FIRE only at a station that had the HOLD ticket", async () => {
      const { v, s, barPrinter, group } = await twoStations({ kitchenOn: true, barOn: false });
      const steak = await lineOf(s, group, "steak", v);
      const fish = await lineOf(s, group, "fish", v);

      await inTx(async (tx) => fireHeldLine(tx, v.cfg, s.partyId, steak.id, await args(s.partyId)));
      const kitchenFire = (await printedSince(v, 1)).filter((job) => job[0] === "*** FIRE ***");
      expect(kitchenFire).toHaveLength(1);
      expect(kitchenFire[0]).toContain(`1 x ${DISHES.steak.kitchen}`);

      const barBefore = (await paperAt(barPrinter)).length;
      await inTx(async (tx) => fireHeldLine(tx, v.cfg, s.partyId, fish.id, await args(s.partyId)));
      const bar = (await paperAt(barPrinter)).slice(barBefore);
      expect(bar.map((job) => job[0])).not.toContain("*** FIRE ***");
      const fishTicket = bar.filter((job) => job.includes(`1 x ${DISHES.fish.kitchen}`));
      expect(fishTicket).toHaveLength(1);
      expect(fishTicket[0]![0]).toBe("Bar");
    });

    describe("HOLD corrections from group changes", () => {
      /**
       * Kitchen (Steak, the venue's printer) prints held work, Bar (Fish, its own printer) does
       * not, and Screen (Flan, no printer) does; one held group of `dishes` is submitted.
       */
      async function threeStations(dishes: Dish[] = ["steak", "fish", "flan"]) {
        const v = await setupVenue();
        const barId = await seedKitchenStation(db, {
          name: "Bar",
          isDefault: false,
        });
        const screenId = await seedKitchenStation(db, {
          name: "Screen",
          isDefault: false,
        });
        const barPrinter = await inTx(async (tx) => {
          for (const [dish, stationId] of [
            ["fish", barId],
            ["flan", screenId],
          ] as const)
            await setRoutingCell(
              tx,
              { row: { kind: "product", productId: v.productId[dish] }, zoneId: null },
              { kind: "station", stationId },
            );
          const printer = await createPrinter(tx, {
            name: "Barra",
            transport: "cloud_poll",
            pollId: `poll-${randomUUID()}`,
          });
          await attachPrinterToStation(tx, {
            stationId: barId,
            printerId: printer.id,
          });
          await setStationPrinting(tx, { printHeldWork: true });
          await setStationPrinting(tx, { printHeldWork: false }, [barId]);
          return printer.id;
        });
        const s = await seated(v);
        const [group] = (
          await submit(v, s.partyId, [
            { release: "hold", lines: dishes.map((dish) => line(v, dish)) },
          ])
        ).groups;
        return { v, s, barId, screenId, barPrinter, group: group!.id };
      }

      const noticeKinds = (stationId: string) =>
        inTx(async (tx) =>
          (await listStationNotices(tx, stationId)).map((notice) => ({
            kind: notice.kind,
            direction: notice.direction,
          })),
        );

      const join = (v: Venue, s: Seated, group: string, dishes: Dish[]) =>
        submit(v, s.partyId, [{ release: "hold", lines: dishes.map((dish) => line(v, dish)) }], {
          joinGroupId: group,
        });

      it("removing a held dish corrects the HOLD ticket only at a station recorded for the group, and tells every station's screen", async () => {
        const { v, s, barId, screenId, barPrinter, group } = await threeStations();
        for (const dish of ["steak", "fish", "flan"] as const) {
          const removed = await lineOf(s, group, dish, v);
          await inTx((tx) => cancelLine(tx, v.cfg, s.tabId, removed.lineNo, undefined, MIA));
        }

        expect(await printedSince(v, 1)).toEqual([
          [
            "*** HOLD CANCELLED ***",
            ...(await head(v, s)),
            "GROUP 1 · MAINS",
            `1 x ${DISHES.steak.kitchen}`,
          ],
        ]);
        expect(await paperAt(barPrinter)).toEqual([]);
        expect(await noticeKinds(barId)).toEqual([{ kind: "void", direction: null }]);
        expect(await noticeKinds(screenId)).toEqual([{ kind: "void", direction: null }]);
      });

      it("moving a held dish between printed groups takes it off and adds it only at stations recorded for each group", async () => {
        const { v, s, barId, screenId, barPrinter, group } = await threeStations();
        const [second] = (
          await submit(v, s.partyId, [
            { release: "hold", lines: [line(v, "steak"), line(v, "fish"), line(v, "flan")] },
          ])
        ).groups;
        const moving = await Promise.all(
          (["steak", "fish", "flan"] as const).map((dish) => lineOf(s, group, dish, v)),
        );
        const [screenTicket] = await db
          .select()
          .from(ticketItems)
          .where(eq(ticketItems.workingOrderLineId, moving[2]!.id));
        expect(screenTicket).toMatchObject({ stationId: screenId, holdPaperQueued: false });

        await move(
          v,
          s.partyId,
          moving.map((row) => ({ lineId: row.id, quantity: "1" })),
          { groupId: second!.id },
        );

        const header = await head(v, s);
        expect(await printedSince(v, 2)).toEqual([
          ["*** HOLD CHANGED ***", ...header, "GROUP 1 · MAINS", `-1 x ${DISHES.steak.kitchen}`],
          ["*** HOLD CHANGED ***", ...header, "GROUP 2 · MAINS", `+1 x ${DISHES.steak.kitchen}`],
        ]);
        expect(await paperAt(barPrinter)).toEqual([]);
        const removedThenAdded = [
          { kind: "changed", direction: "removed" },
          { kind: "changed", direction: "added" },
        ];
        expect(await noticeKinds(barId)).toEqual(removedThenAdded);
        expect(await noticeKinds(screenId)).toEqual(removedThenAdded);
        expect(await recorded(second!.id)).toEqual([
          { groupId: second!.id, stationId: v.stationId },
        ]);
        const [steak] = await db
          .select()
          .from(ticketItems)
          .where(eq(ticketItems.workingOrderLineId, moving[0]!.id));
        expect(steak).toMatchObject({ stationId: v.stationId, holdPaperQueued: true });
      });

      it("a station with no printer is not recorded for a dish joining there", async () => {
        const { v, s, screenId, group } = await threeStations(["steak", "fish"]);

        await join(v, s, group, ["flan"]);

        expect(await recorded(group)).toEqual([{ groupId: group, stationId: v.stationId }]);
        expect(await noticeKinds(screenId)).toEqual([{ kind: "changed", direction: "added" }]);
      });

      it("firing one held dish takes it off the HOLD ticket only at a station recorded for the group", async () => {
        const { v, s, barPrinter, group } = await threeStations();
        const steak = await lineOf(s, group, "steak", v);
        const fish = await lineOf(s, group, "fish", v);

        await inTx(async (tx) =>
          fireHeldLine(tx, v.cfg, s.partyId, steak.id, await args(s.partyId)),
        );
        await inTx(async (tx) =>
          fireHeldLine(tx, v.cfg, s.partyId, fish.id, await args(s.partyId)),
        );

        expect((await printedSince(v, 1))[0]).toEqual([
          "*** HOLD CHANGED ***",
          ...(await head(v, s)),
          "GROUP 1 · MAINS",
          `-1 x ${DISHES.steak.kitchen}`,
        ]);
        const bar = await paperAt(barPrinter);
        expect(bar).toHaveLength(1);
        expect(bar[0]!.join("\n")).not.toContain("***");
      });

      it("a held edit's quantity change corrects the HOLD ticket only at a station recorded for the group", async () => {
        const { v, s, barId, barPrinter, group } = await threeStations();
        const steak = await lineOf(s, group, "steak", v);
        const fish = await lineOf(s, group, "fish", v);

        await changeLine(v, s.tabId, fish.lineNo, { portionLineNos: [], quantity: "2" }, MIA);
        await changeLine(v, s.tabId, steak.lineNo, { portionLineNos: [], quantity: "2" }, MIA);

        expect(await printedSince(v, 1)).toEqual([
          [
            "*** HOLD CHANGED ***",
            ...(await head(v, s)),
            "GROUP 1 · MAINS",
            `+1 x ${DISHES.steak.kitchen}`,
          ],
        ]);
        expect(await paperAt(barPrinter)).toEqual([]);
        expect(await noticeKinds(barId)).toEqual([{ kind: "changed", direction: "added" }]);
      });

      it("a held dish moved into a printed group holding none of a station's held work gets HOLD CHANGED there, and records it", async () => {
        const { v, s, barId, barPrinter, group } = await threeStations();
        const [second] = (
          await submit(v, s.partyId, [{ release: "hold", lines: [line(v, "steak")] }])
        ).groups;
        await setHeld(true, barId);
        const fish = await lineOf(s, group, "fish", v);

        await move(v, s.partyId, [{ lineId: fish.id, quantity: "1" }], { groupId: second!.id });

        const bar = await paperAt(barPrinter);
        expect(bar).toHaveLength(1);
        expect(bar[0]![0]).toBe("*** HOLD CHANGED ***");
        expect(bar[0]).toContain("GROUP 2 · MAINS");
        expect(bar[0]).toContain(`+1 x ${DISHES.fish.kitchen}`);
        expect((await recorded(second!.id)).map((row) => row.stationId).sort()).toEqual(
          [v.stationId, barId].sort(),
        );
        expect(await recorded(group)).toEqual([{ groupId: group, stationId: v.stationId }]);
      });

      it("a station switched off after its HOLD ticket printed still gets +N for a joining dish", async () => {
        const { v, s, screenId, barPrinter, group } = await threeStations();
        await setHeld(false, v.stationId);

        await join(v, s, group, ["steak", "fish", "flan"]);

        expect(await printedSince(v, 1)).toEqual([
          [
            "*** HOLD CHANGED ***",
            ...(await head(v, s)),
            "GROUP 1 · MAINS",
            `+1 x ${DISHES.steak.kitchen}`,
          ],
        ]);
        expect(await paperAt(barPrinter)).toEqual([]);
        expect(await noticeKinds(screenId)).toEqual([{ kind: "changed", direction: "added" }]);
      });

      it("a station switched on after the group was held gets nothing for a joining dish, and its whole part prints unmarked at the fire", async () => {
        const { v, s, barId, screenId, barPrinter, group } = await threeStations();
        await setHeld(true, barId);

        await join(v, s, group, ["fish", "flan"]);

        expect(await paperAt(barPrinter)).toEqual([]);
        expect(await recorded(group)).toEqual([{ groupId: group, stationId: v.stationId }]);
        expect(await noticeKinds(screenId)).toEqual([{ kind: "changed", direction: "added" }]);

        await fire(v, s.partyId, group);

        const bar = await paperAt(barPrinter);
        expect(bar).toHaveLength(1);
        expect(bar[0]![0]).toBe("Bar");
        expect(bar[0]!.join("\n")).not.toContain("***");
        expect(bar[0]!.filter((row) => row.endsWith(` x ${DISHES.fish.kitchen}`))).toEqual([
          `2 x ${DISHES.fish.kitchen}`,
        ]);
      });

      it("a station switched on after the group was held, holding none of its held work, gets HOLD CHANGED for a joining dish and is recorded", async () => {
        const { v, s, barId, barPrinter, group } = await threeStations(["steak", "flan"]);
        await setHeld(true, barId);

        await join(v, s, group, ["fish"]);

        const bar = await paperAt(barPrinter);
        expect(bar).toHaveLength(1);
        expect(bar[0]![0]).toBe("*** HOLD CHANGED ***");
        expect(bar[0]).toContain(`+1 x ${DISHES.fish.kitchen}`);
        expect((await recorded(group)).map((row) => row.stationId).sort()).toEqual(
          [v.stationId, barId].sort(),
        );

        await fire(v, s.partyId, group);

        expect((await paperAt(barPrinter)).slice(1).map((job) => job[0])).toEqual(["*** FIRE ***"]);
      });
    });
  });

  describe("retries (D8) print nothing the second time", () => {
    it("prints a repeated held submission's HOLD ticket once", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await seated(v);
      const opts = { submissionId: randomUUID(), revision: await revisionOf(s.partyId) };
      const groups = [{ release: "hold" as const, lines: [line(v, "steak")] }];

      await submit(v, s.partyId, groups, opts);
      await submit(v, s.partyId, groups, opts);

      expect((await printed(v)).map((job) => ticketLines(job)[0])).toEqual(["*** HOLD ***"]);
    });

    it("prints a repeated move's corrections once", async () => {
      const v = await setupVenue();
      await printHeldWork(true);
      const s = await specExample(v, "grouped");
      const steak = await lineOf(s, s.mains, "steak", v);
      const opts = { submissionId: randomUUID(), revision: await revisionOf(s.partyId) };
      const moves = [{ lineId: steak.id, quantity: "1" }];

      await move(v, s.partyId, moves, { groupId: s.desserts }, opts);
      await move(v, s.partyId, moves, { groupId: s.desserts }, opts);

      expect(await printedSince(v, 5)).toHaveLength(2);
      expect(await noticesAt(v)).toHaveLength(2);
    });
  });
});
