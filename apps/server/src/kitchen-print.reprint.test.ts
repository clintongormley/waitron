import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import { fireTableKitchenOrder } from "./testing/kitchen-table-order.js";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ticketItems, workingOrderLines } from "@waitron/db";
import { createCourse, createStation } from "./kitchen.js";
import { fireOrderLines } from "./working-order-kitchen-service.js";
import { kitchenNotices } from "@waitron/venue-service";
import { setStationPrinting } from "./testing/station-printing.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { attachPrinterToStation } from "./station-printers.js";
import { reprintOrderTickets } from "./kitchen-ticket-reprint.js";
import { decodeTicket, printedLines } from "./testing/decode-ticket.js";
import { routeProductTo } from "./testing/zone-offers.js";
import { inTx, seatWithNoAllergies, setupPartyVenue } from "./testing/party-venue.js";
import "./errors.js";
import { setupVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import {
  bindKitchenPrintDb,
  useKitchenPrintDb,
  db,
  OPERATOR,
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

describe("reprintOrderTickets (re-enqueue the WHOLE current ticket for an order)", () => {
  it("re-enqueues EVERY currently-fired item across all fire rounds — not just the last round (the print-on-fire contrast)", async () => {
    const { cfg } = await setupVenue();
    const { pStation, pGroup, beforeReprint, afterReprint } = await asApp(async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const pStation = await makePrinter(tx, "Kitchen printer");
      const pGroup = await makeSharedPrinter(tx, "Pass", [kitchenStation.id]);
      await attachPrinterToStation(tx, {
        stationId: kitchenStation.id,
        printerId: pStation,
      });
      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const mainCourse = await createCourse(tx, { name: "Mains", displayOrder: 1 });
      const soup = await makeProduct(tx, "Soup", {
        stationId: kitchenStation.id,
        courseId: starterCourse.id,
      });
      const steak = await makeProduct(tx, "Ribeye", {
        stationId: kitchenStation.id,
        courseId: mainCourse.id,
      });

      // Two rounds: round 1 fires the soup and holds the steak, round 2 releases the steak.
      const orderId = await fireTableKitchenOrder(tx, cfg, [line(soup), line(steak)]);
      const [held] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(
          and(
            eq(workingOrderLines.workingOrderId, orderId),
            eq(workingOrderLines.productId, steak),
          ),
        );
      const [beforeRelease] = await tx
        .select({ firedAt: ticketItems.firedAt })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderLineId, held!.id));
      expect(beforeRelease!.firedAt).toBeNull();
      await fireOrderLines(tx, cfg, orderId, [held!.id]);
      const beforeReprint = await printJobsFor(tx);

      await reprintOrderTickets(tx, cfg, orderId);
      const afterReprint = await printJobsFor(tx);
      return { pStation, pGroup, beforeReprint, afterReprint };
    });

    const beforeIds = new Set(beforeReprint.map((j) => j.id));
    const newJobs = afterReprint.filter((j) => !beforeIds.has(j.id));

    // One station ticket and one consolidated group ticket.
    const newStation = newJobs.filter((j) => j.printerId === pStation);
    const newGroup = newJobs.filter((j) => j.printerId === pGroup);
    expect(newStation).toHaveLength(1);
    expect(newGroup).toHaveLength(1);
    expect(newJobs).toHaveLength(2);

    // Both rounds' items, where round 2's print-on-fire ticket carried only Ribeye.
    const stationTicket = decodeTicket(newStation[0]!.payload);
    expect(stationTicket).toContain("Soup");
    expect(stationTicket).toContain("Ribeye");

    const groupTicket = decodeTicket(newGroup[0]!.payload);
    expect(groupTicket).toContain("Soup");
    expect(groupTicket).toContain("Ribeye");
    expect(groupTicket).toContain("Kitchen");
  });

  it("prints the quantity each item was fired at, not its line's current quantity", async () => {
    const { cfg } = await setupVenue();
    const { released, reprinted } = await asApp(async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const printerId = await makePrinter(tx, "Kitchen printer");
      await attachPrinterToStation(tx, {
        stationId: kitchenStation.id,
        printerId,
      });
      const starterCourse = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const mainCourse = await createCourse(tx, { name: "Mains", displayOrder: 1 });
      const soup = await makeProduct(tx, "Soup", {
        stationId: kitchenStation.id,
        courseId: starterCourse.id,
      });
      const steak = await makeProduct(tx, "Ribeye", {
        stationId: kitchenStation.id,
        courseId: mainCourse.id,
      });
      // Three soups fire; two steaks are held by their course.
      const orderId = await fireTableKitchenOrder(tx, cfg, [
        { productId: soup, quantity: "3" },
        { productId: steak, quantity: "2" },
      ]);
      // Each line now bills one, as after splitting the rest off to another check.
      await tx.execute(sql`
        update working_order_lines set quantity = 1000 where working_order_id = ${orderId}`);
      const beforeRelease = new Set((await printJobsFor(tx)).map((job) => job.id));
      const [held] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(
          and(
            eq(workingOrderLines.workingOrderId, orderId),
            eq(workingOrderLines.productId, steak),
          ),
        );
      await fireOrderLines(tx, cfg, orderId, [held!.id]);
      const released = (await printJobsFor(tx)).filter((job) => !beforeRelease.has(job.id));
      const beforeReprint = new Set((await printJobsFor(tx)).map((job) => job.id));
      await reprintOrderTickets(tx, cfg, orderId);
      const reprinted = (await printJobsFor(tx)).filter((job) => !beforeReprint.has(job.id));
      return { released, reprinted };
    });

    expect(released).toHaveLength(1);
    expect(decodeTicket(released[0]!.payload)).toContain(`2 x Ribeye`);
    expect(reprinted).toHaveLength(1);
    const reprint = decodeTicket(reprinted[0]!.payload);
    expect(reprint).toContain(`3 x Soup`);
    expect(reprint).toContain(`2 x Ribeye`);
  });

  it("a reprint prints the HOLD part only for a station recorded for the group", async () => {
    const v = await setupPartyVenue(db);
    const { kitchen, bar, screen } = await inTx(v, async (tx) => {
      const station = async (name: string, dish: string, withPrinter: boolean) => {
        const { id } = await createStation(tx, { name });
        await routeProductTo(tx, v.productId(dish), id);
        const printerId = withPrinter ? await makeSharedPrinter(tx, name, [id]) : null;
        return { id, printerId };
      };
      const kitchen = await station("Kitchen", "Burger", true);
      const bar = await station("Bar", "Paella", true);
      const screen = await station("Screen", "Flan", false);
      await setStationPrinting(tx, { printHeldWork: true }, [kitchen.id]);
      return { kitchen, bar, screen };
    });
    const { partyId, tabId } = await seatWithNoAllergies(v, await v.table("Table 131"));
    const dish = (name: string) => ({ menuItemId: v.item(name), quantity: "1" });
    await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, partyId, {
        groups: [{ lines: [dish("Burger"), dish("Paella"), dish("Flan")], release: "hold" }],
        operatorId: OPERATOR,
        billId: tabId,
      }),
    );
    const jobsAt = async (printerId: string) =>
      (await asApp((tx) => printJobsFor(tx)))
        .filter((job) => job.printerId === printerId)
        .map((job) => printedLines(job.payload));
    expect(await jobsAt(kitchen.printerId!)).toHaveLength(1);
    expect(await jobsAt(bar.printerId!)).toEqual([]);

    await inTx(v, (tx) => reprintOrderTickets(tx, v.cfg, tabId));

    const reprinted = (await jobsAt(kitchen.printerId!)).slice(1);
    expect(reprinted).toHaveLength(1);
    expect(reprinted[0]![0]).toMatch(
      new RegExp(
        `^\\*\\*\\* ${kitchenTicketWords("es").reprint.replace("{time}", "\\d\\d:\\d\\d")} \\*\\*\\*$`,
      ),
    );
    expect(reprinted[0]![1]).toBe(`*** ${kitchenTicketWords("es").hold} ***`);
    expect(reprinted[0]).toContain("1 x BURG");
    expect(await jobsAt(bar.printerId!)).toEqual([]);
    expect(
      await db
        .select({ kind: kitchenNotices.kind })
        .from(kitchenNotices)
        .where(eq(kitchenNotices.stationId, screen.id)),
    ).toEqual([]);
  });

  it("enqueues nothing (and does NOT throw) for an order with no fired items", async () => {
    const { cfg } = await setupVenue();
    const jobs = await asApp(async (tx) => {
      const kitchenStation = await createStation(tx, { name: "Kitchen", isDefault: true });
      const printerId = await makePrinter(tx, "Kitchen printer");
      await attachPrinterToStation(tx, {
        stationId: kitchenStation.id,
        printerId,
      });
      await makeProduct(tx, "Ribeye", { stationId: kitchenStation.id });

      await reprintOrderTickets(tx, cfg, randomUUID());
      return printJobsFor(tx);
    });
    expect(jobs).toHaveLength(0);
  });
});
