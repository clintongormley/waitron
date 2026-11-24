import {
  type Transaction,
  printJobs,
  withTransaction,
  workingOrders,
  ticketItems,
  workingOrderLines,
} from "@waitron/db";
import { createProduct } from "@waitron/menu";
import { eq } from "drizzle-orm";
import { setProductCourse, createCourse, createStation } from "./kitchen.js";
import { cancelLine } from "./testing/cancel-line.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { updateOrderLine } from "./testing/order-writer-fixture.js";
import { openPartyTab } from "./testing/serve-line.js";
import {
  setupVenue,
  db,
  attachedPrinter,
  makeTable,
  addRound,
  line,
  byLine,
  courseItemsFor,
  addOptionList,
  revisionOf,
  OPERATOR,
} from "./testing/working-order.test-support.js";

describe("correction slips on line changes and cancellations", () => {
  /** Create a sellable product with a KNOWN name (so the slip payload can be asserted for it), routed to
   *  an optional course. Station routing is left to the venue default. */
  async function namedProduct(tx: Transaction, name: string, courseId?: string): Promise<string> {
    const { id } = await createProduct(tx, {
      categoryId: null,
      name: name,
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    if (courseId !== undefined) await setProductCourse(tx, id, courseId);
    return id;
  }

  /** Read print-job ids for the before/after enqueue comparison. */
  async function jobRows(
    tx: Transaction,
  ): Promise<{ id: string; printerId: string; payload: Uint8Array }[]> {
    return (
      await tx
        .select({ id: printJobs.id, printerId: printJobs.printerId, payload: printJobs.payload })
        .from(printJobs)
    ).map((job) => ({ ...job, payload: job.payload! }));
  }

  it("(c) voiding a FIRED line enqueues ONE VOID slip at that station's printer", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const { printerId: kitchenPrinterId } = await attachedPrinter(
        tx,
        { name: "Kitchen", isDefault: true },
        "P-Kitchen",
      );
      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const starter = await namedProduct(tx, "Croquettes", starterCourse.id);
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, cfg, { tableId });

      await addRound(tx, cfg, tabId, [line(starter)]);
      expect(byLine(await courseItemsFor(tx, tabId), starter).firedAt).not.toBeNull();
      const before = await jobRows(tx);

      await cancelLine(tx, cfg, tabId, 1);

      const after = await jobRows(tx);
      const fresh = after.filter((j) => !before.some((b) => b.id === j.id));
      expect(fresh).toHaveLength(1);
      expect(fresh[0]!.printerId).toBe(kitchenPrinterId);
      const text = decodeTicket(fresh[0]!.payload);
      expect(text).toContain("VOID");
      expect(text).toContain("Croquettes");
    });
  });

  it("(e) changing a FIRED, not-started line prints a RECALLED slip and a ticket for the changed line", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const { printerId } = await attachedPrinter(
        tx,
        { name: "Kitchen", isDefault: true },
        "P-Kitchen",
      );
      const starter = await namedProduct(tx, "Croquettes");
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, cfg, { tableId });
      await addRound(tx, cfg, tabId, [line(starter)]);
      const [{ revision }] = await tx
        .select({ revision: workingOrders.revision })
        .from(workingOrders)
        .where(eq(workingOrders.id, tabId));
      const before = await jobRows(tx);

      await updateOrderLine(tx, cfg, tabId, 1, { portionLineNos: [], note: "No onion" }, revision!);

      const fresh = (await jobRows(tx)).filter((j) => !before.some((b) => b.id === j.id));
      expect(fresh.map((job) => job.printerId)).toEqual([printerId, printerId]);
      const [slip, ticket] = fresh.map((job) => decodeTicket(job.payload));
      expect(slip).toContain("RECALLED");
      expect(slip).toContain("Croquettes");
      expect(ticket).not.toContain("RECALLED");
      expect(ticket).toContain("Croquettes");
      expect(ticket).toContain("No onion");
    });
  });

  it("still recalls and resends a fired dish whose options answer one dish's change replaces", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const { tabId, cooking } = await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const cooking = await addOptionList(tx, coffeeId, "Cooking", ["Rare", "Well done"]);
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, cfg, { tableId });
      await addRound(tx, cfg, tabId, [
        {
          productId: coffeeId,
          quantity: "1",
          options: [{ listId: cooking.listId, labelId: cooking.labelIds[0]! }],
        },
      ]);
      return { tabId, cooking };
    });
    const itemsOf = () =>
      db
        .select({ id: ticketItems.id, firedAt: ticketItems.firedAt })
        .from(ticketItems)
        .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
        .where(eq(workingOrderLines.workingOrderId, tabId));
    const [fired] = await itemsOf();
    expect(fired!.firedAt).not.toBeNull();

    const revision = await revisionOf(tabId);
    await withTransaction(db, (tx) =>
      updateOrderLine(
        tx,
        cfg,
        tabId,
        1,
        {
          portionLineNos: [],
          options: [{ listId: cooking.listId, labelId: cooking.labelIds[1]! }],
        },
        revision,
        OPERATOR,
      ),
    );

    const resent = await itemsOf();
    expect(resent).toEqual([{ id: expect.any(String), firedAt: expect.any(String) }]);
    expect(resent[0]!.id).not.toBe(fired!.id);
    const [line] = await db
      .select({ optionSnapshots: workingOrderLines.optionSnapshots })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId));
    expect(line!.optionSnapshots).toEqual([
      expect.objectContaining({ labelKitchenName: "Well done kitchen" }),
    ]);
  });

  it("(d) voiding a HELD line no HOLD ticket carries enqueues NO slip", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await attachedPrinter(tx, { name: "Kitchen", isDefault: true }, "P-Kitchen");
      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const mainCourse = await createCourse(tx, { name: "Mains", displayOrder: 1 });
      const starter = await namedProduct(tx, "Croquettes", starterCourse.id);
      const main = await namedProduct(tx, "Chuleton", mainCourse.id);
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, cfg, { tableId });

      // starter (line 1) auto-fires; main (line 2) is HELD — never printed.
      await addRound(tx, cfg, tabId, [line(starter), line(main)]);
      expect(byLine(await courseItemsFor(tx, tabId), main).firedAt).toBeNull();
      const before = await jobRows(tx);

      await cancelLine(tx, cfg, tabId, 2);

      const after = await jobRows(tx);
      const fresh = after.filter((j) => !before.some((b) => b.id === j.id));
      expect(fresh).toHaveLength(0);
    });
  });
});
