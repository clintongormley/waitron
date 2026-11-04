import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  deviceProfiles,
  printJobs,
  ticketItems,
  withTransaction,
  workingOrderLines,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter } from "@waitron/printing";
import { createCourse, createStation, setProductCourse } from "./kitchen.js";
import { attachPrinterToStation } from "./station-printers.js";
import { fireGroup } from "./order-groups.js";
import { reprintOrderTickets } from "./kitchen-print.js";
import { groupsWithPassFood, listStationQueue, markServed } from "./working-order.js";
import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import { VENUE_SERVICE } from "./modules.js";
import { passScopeOf, readScopedPassBoard } from "./pass-board.js";
import { releasePassItems, type PassActor } from "./pass-release.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { setStationPrinting } from "./testing/station-printing.js";
import { routeProductTo } from "./testing/zone-offers.js";
import { printedLines } from "./testing/decode-ticket.js";
import { cancelLine } from "./testing/cancel-line.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { useSplitExtrasDb } from "./testing/split-extras-venue.js";
import {
  OPERATOR,
  inTx,
  revisionOf,
  seatWithNoAllergies,
  setupPartyVenue,
  split,
  type PartyVenue,
} from "./testing/party-venue.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let db: Database;
beforeAll(() => {
  db = suite.db;
  useSplitExtrasDb(db);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const words = kitchenTicketWords("es");
const CUE = words.goesWithKitchenFood;

interface Kitchen {
  v: PartyVenue;
  grill: string;
  bar: string;
  grillPrinter: string;
  barPrinter: string;
  partyId: string;
  tabId: string;
}

/** Tarta at Grill and Vino at Bar, both Desserts, Caña at Bar with no course; each station prints. */
async function kitchen(grillWaits: boolean): Promise<Kitchen> {
  const v = await setupPartyVenue(db);
  const stations = await inTx(v, async (tx) => {
    const { id: grill } = await createStation(tx, v.cfg, { name: "Grill" });
    const { id: bar } = await createStation(tx, v.cfg, { name: "Bar" });
    const desserts = await createCourse(tx, v.cfg, { name: "Desserts", displayOrder: 3 });
    await routeProductTo(tx, v.cfg, v.productId("Tarta"), grill);
    await routeProductTo(tx, v.cfg, v.productId("Vino"), bar);
    await routeProductTo(tx, v.cfg, v.productId("Caña"), bar);
    await setProductCourse(tx, v.cfg, v.productId("Tarta"), desserts.id);
    await setProductCourse(tx, v.cfg, v.productId("Vino"), desserts.id);
    const printer = async (name: string, stationId: string) => {
      const { id } = await createPrinter(tx, {
        name,
        transport: "cloud_poll",
        pollId: `poll-${randomUUID()}`,
      });
      await attachPrinterToStation(tx, { stationId, printerId: id });
      return id;
    };
    if (grillWaits) await setStationsWaitForPass(tx, true, [grill]);
    return {
      grill,
      bar,
      grillPrinter: await printer("Grill", grill),
      barPrinter: await printer("Bar", bar),
    };
  });
  const { partyId, tabId } = await seatWithNoAllergies(v, await v.table("Table 141"));
  return { v, ...stations, partyId, tabId };
}

const dish = (k: Kitchen, name: string) => ({ menuItemId: k.v.item(name), quantity: "1" });

async function place(k: Kitchen, groups: { names: string[]; release: "hold" | "fire" }[]) {
  const placed = await inTx(k.v, (tx) =>
    placeGroups(tx, k.v.cfg, k.partyId, {
      groups: groups.map((group) => ({
        lines: group.names.map((name) => dish(k, name)),
        release: group.release,
      })),
      operatorId: OPERATOR,
      billId: k.tabId,
    }),
  );
  return placed.groups.map((group) => group.id);
}

async function fire(k: Kitchen, groupId: string): Promise<void> {
  const expectedPartyRevision = await revisionOf(k.v, k.partyId);
  await inTx(k.v, (tx) =>
    fireGroup(tx, k.v.cfg, k.partyId, groupId, {
      operatorId: OPERATOR,
      submissionId: randomUUID(),
      expectedPartyRevision,
    }),
  );
}

/** Every job's printed lines at `printerId`, oldest first. */
async function papers(k: Kitchen, printerId: string): Promise<string[][]> {
  const jobs = await inTx(k.v, (tx) =>
    tx
      .select({ payload: printJobs.payload })
      .from(printJobs)
      .where(eq(printJobs.printerId, printerId))
      .orderBy(sql`rowid`),
  );
  return jobs.map((job) => printedLines(job.payload));
}

/** The lines from `paper`'s first group heading on. */
const fromHeading = (paper: string[]) =>
  paper.slice(paper.findIndex((text) => text.startsWith(words.group)));

async function passDevice(k: Kitchen): Promise<PassActor> {
  const [profile] = await withTransaction(db, (tx) =>
    tx
      .insert(deviceProfiles)
      .values({
        name: "Pass profile",
        formFactor: "kds",
        capabilities: ["act-as-kds", "prepare-orders", "run-the-pass"],
      })
      .returning({ id: deviceProfiles.id }),
  );
  const joined = await enrolDeviceForTest(db, k.v.cfg, {
    name: "Pass",
    profileId: profile!.id,
    kitchenScreen: { kind: "pass", stationIds: null, zoneIds: null },
  });
  return { deviceId: joined.deviceId, personId: null };
}

/** The pass releases `groupId`'s card. */
async function releaseAtPass(k: Kitchen, groupId: string): Promise<void> {
  const by = await passDevice(k);
  await withTransaction(db, async (tx) => {
    const screen = (await VENUE_SERVICE.readDeviceKitchenScreens(tx, k.v.cfg, by.deviceId)).find(
      (candidate) => candidate.kind === "pass",
    )!;
    const card = (await readScopedPassBoard(tx, k.v.cfg, passScopeOf(screen))).toFire.find(
      (candidate) => candidate.target.kind === "group" && candidate.target.groupId === groupId,
    )!;
    await releasePassItems(tx, k.v.cfg, by, {
      submissionId: randomUUID(),
      target: card.target,
      ticketItemIds: card.releaseTicketItemIds,
      expectedContext: card.releaseContext,
    });
  });
}

describe("A773 fire paper: Goes with kitchen food", () => {
  it("A773 fire paper: a group has kitchen food at the pass", async () => {
    const k = await kitchen(false);
    const [releasedBefore] = await place(k, [{ names: ["Tarta"], release: "fire" }]);
    await inTx(k.v, (tx) => setStationsWaitForPass(tx, true, [k.grill]));
    const [passControlled, held, cancelled] = await place(k, [
      { names: ["Tarta"], release: "fire" },
      { names: ["Tarta"], release: "hold" },
      { names: ["Tarta"], release: "fire" },
    ]);
    await inTx(k.v, async (tx) => {
      const [line] = await tx
        .select({ lineNo: workingOrderLines.lineNo })
        .from(workingOrderLines)
        .where(
          and(
            eq(workingOrderLines.workingOrderId, k.tabId),
            eq(workingOrderLines.groupId, cancelled!),
          ),
        );
      await cancelLine(tx, k.v.cfg, k.tabId, line!.lineNo);
    });

    const answer = await inTx(k.v, (tx) =>
      groupsWithPassFood(tx, [releasedBefore!, passControlled!, held!, cancelled!]),
    );
    expect([...answer].sort()).toEqual([passControlled!, held!].sort());
    expect(await inTx(k.v, (tx) => groupsWithPassFood(tx, []))).toEqual(new Set());
  });

  it("A773 fire paper: a dish fired before request times were kept counts as released", async () => {
    const k = await kitchen(false);
    const [group] = await place(k, [{ names: ["Tarta"], release: "fire" }]);
    await inTx(k.v, async (tx) => {
      await setStationsWaitForPass(tx, true, [k.grill]);
      const [line] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.groupId, group!));
      await tx
        .update(ticketItems)
        .set({ requestedAt: null })
        .where(eq(ticketItems.workingOrderLineId, line!.id));
    });
    expect(await inTx(k.v, (tx) => groupsWithPassFood(tx, [group!]))).toEqual(new Set());
  });

  it("A773 fire paper: the bar's ticket says it goes with the kitchen's food", async () => {
    const k = await kitchen(true);
    const [desserts] = await place(k, [{ names: ["Tarta", "Vino"], release: "hold" }]);
    await fire(k, desserts!);

    const bar = await papers(k, k.barPrinter);
    expect(bar).toHaveLength(1);
    expect(fromHeading(bar[0]!).slice(0, 3)).toEqual([
      `${words.group} 1 · DESSERTS`,
      CUE,
      "1.000 x TINTO",
    ]);
    expect(await papers(k, k.grillPrinter)).toEqual([]);

    await releaseAtPass(k, desserts!);
    const grill = await papers(k, k.grillPrinter);
    expect(grill).toHaveLength(1);
    expect(fromHeading(grill[0]!).slice(0, 2)).toEqual([
      `${words.group} 1 · DESSERTS`,
      "1.000 x TARTA",
    ]);
    expect(grill[0]).not.toContain(CUE);
  });

  it("A773 fire paper: two bills of one group", async () => {
    const k = await kitchen(true);
    const [desserts] = await place(k, [{ names: ["Vino", "Tarta"], release: "hold" }]);
    const [tarta] = await inTx(k.v, (tx) =>
      tx
        .select({ lineNo: workingOrderLines.lineNo })
        .from(workingOrderLines)
        .where(
          and(
            eq(workingOrderLines.workingOrderId, k.tabId),
            eq(workingOrderLines.productId, k.v.productId("Tarta")),
          ),
        ),
    );
    const billTwo = await split(k.v, k.partyId, k.tabId, [tarta!.lineNo]);
    expect(billTwo).not.toBe(k.tabId);
    await fire(k, desserts!);

    const bar = await papers(k, k.barPrinter);
    expect(bar).toHaveLength(1);
    expect(fromHeading(bar[0]!).slice(0, 2)).toEqual([`${words.group} 1 · DESSERTS`, CUE]);
  });

  it("A773 fire paper: a reprint after the kitchen's dish is served has no cue", async () => {
    const k = await kitchen(true);
    const [desserts] = await place(k, [{ names: ["Tarta", "Vino"], release: "hold" }]);
    await fire(k, desserts!);
    await releaseAtPass(k, desserts!);

    await inTx(k.v, (tx) => reprintOrderTickets(tx, k.v.cfg, k.tabId));
    const before = await papers(k, k.barPrinter);
    expect(before).toHaveLength(2);
    expect(before[1]!.filter((text) => text === CUE)).toHaveLength(1);

    const [tarta] = await inTx(k.v, (tx) =>
      tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(
          and(
            eq(workingOrderLines.workingOrderId, k.tabId),
            eq(workingOrderLines.productId, k.v.productId("Tarta")),
          ),
        ),
    );
    const expectedPartyRevision = await revisionOf(k.v, k.partyId);
    await inTx(k.v, (tx) =>
      markServed(tx, k.v.cfg, k.partyId, [{ lineId: tarta!.id, quantity: "1" }], {
        operatorId: OPERATOR,
        submissionId: randomUUID(),
        expectedPartyRevision,
      }),
    );
    await inTx(k.v, (tx) => reprintOrderTickets(tx, k.v.cfg, k.tabId));
    const after = await papers(k, k.barPrinter);
    expect(after).toHaveLength(3);
    expect(after[2]).toContain("1.000 x TINTO");
    expect(after[2]).not.toContain(CUE);
  });

  describe("A773 fire paper: no cue without food at the pass", () => {
    it("A773 fire paper: no cue when nobody waits for the pass", async () => {
      const k = await kitchen(false);
      const [desserts] = await place(k, [{ names: ["Tarta", "Vino"], release: "hold" }]);
      await fire(k, desserts!);
      const both = [...(await papers(k, k.barPrinter)), ...(await papers(k, k.grillPrinter))];
      expect(both).toHaveLength(2);
      for (const paper of both) expect(paper).not.toContain(CUE);
    });

    it("A773 fire paper: no cue when a held kitchen dish on another bill sits at a station that does not wait", async () => {
      const k = await kitchen(false);
      const [desserts] = await place(k, [{ names: ["Vino", "Tarta"], release: "hold" }]);
      const [tarta] = await inTx(k.v, (tx) =>
        tx
          .select({ lineNo: workingOrderLines.lineNo })
          .from(workingOrderLines)
          .where(
            and(
              eq(workingOrderLines.workingOrderId, k.tabId),
              eq(workingOrderLines.productId, k.v.productId("Tarta")),
            ),
          ),
      );
      const billTwo = await split(k.v, k.partyId, k.tabId, [tarta!.lineNo]);
      expect(billTwo).not.toBe(k.tabId);
      await fire(k, desserts!);

      const bar = await papers(k, k.barPrinter);
      expect(bar).toHaveLength(1);
      expect(fromHeading(bar[0]!).slice(0, 2)).toEqual([
        `${words.group} 1 · DESSERTS`,
        "1.000 x TINTO",
      ]);
      expect(bar[0]).not.toContain(CUE);
    });

    it("A773 fire paper: no cue for an anomalous held made-here record", async () => {
      const k = await kitchen(true);
      const [desserts] = await place(k, [{ names: ["Tarta", "Vino"], release: "hold" }]);
      await inTx(k.v, async (tx) => {
        const [vino] = await tx
          .select({ id: workingOrderLines.id })
          .from(workingOrderLines)
          .where(
            and(
              eq(workingOrderLines.workingOrderId, k.tabId),
              eq(workingOrderLines.productId, k.v.productId("Vino")),
            ),
          );
        await tx
          .update(ticketItems)
          .set({ madeHere: true })
          .where(eq(ticketItems.workingOrderLineId, vino!.id));
      });
      await fire(k, desserts!);
      const bar = await papers(k, k.barPrinter);
      expect(bar).toHaveLength(1);
      expect(bar[0]).toContain("1.000 x TINTO");
      expect(bar[0]).not.toContain(CUE);
    });

    it("A773 fire paper: no cue on a group with nothing for the kitchen", async () => {
      const k = await kitchen(true);
      const [drinks] = await place(k, [{ names: ["Vino", "Caña"], release: "hold" }]);
      await fire(k, drinks!);
      const bar = await papers(k, k.barPrinter);
      expect(bar).toHaveLength(1);
      expect(bar[0]).not.toContain(CUE);
    });

    it("A773 fire paper: no cue on the bar's advance HOLD ticket", async () => {
      const k = await kitchen(true);
      await inTx(k.v, (tx) => setStationPrinting(tx, { printHeldWork: true }, [k.bar]));
      await place(k, [{ names: ["Tarta", "Vino"], release: "hold" }]);
      const hold = await papers(k, k.barPrinter);
      expect(hold).toHaveLength(1);
      expect(hold[0]![0]).toBe(`*** ${words.hold} ***`);
      expect(hold[0]).not.toContain(CUE);
    });
  });
});

describe("A773 fire paper: the cue on the station card", () => {
  /** Each queue item's group at `stationId`, keyed by the item's group id. */
  async function queueGroups(k: Kitchen, stationId: string) {
    const queue = await inTx(k.v, (tx) => listStationQueue(tx, stationId));
    return new Map(
      queue.flatMap((bill) => bill.items).map((item) => [item.group!.id, item.group!]),
    );
  }

  it("A773 fire paper: a station's queue marks a group with kitchen food at the pass", async () => {
    const k = await kitchen(true);
    const [desserts, drinks] = await place(k, [
      { names: ["Tarta", "Vino"], release: "hold" },
      { names: ["Caña"], release: "hold" },
    ]);
    await fire(k, desserts!);
    await fire(k, drinks!);

    const bar = await queueGroups(k, k.bar);
    expect(bar.get(desserts!)).toMatchObject({ id: desserts, goesWithKitchenFood: true });
    expect(bar.get(drinks!)).toBeDefined();
    expect(bar.get(drinks!)).not.toHaveProperty("goesWithKitchenFood");

    await releaseAtPass(k, desserts!);
    expect((await queueGroups(k, k.grill)).get(desserts!)).toMatchObject({
      goesWithKitchenFood: true,
    });
  });

  it("A773 fire paper: the pass board's groups carry no cue key", async () => {
    const k = await kitchen(true);
    const [desserts] = await place(k, [{ names: ["Tarta", "Vino"], release: "hold" }]);
    await fire(k, desserts!);
    const by = await passDevice(k);
    const board = await withTransaction(db, async (tx) => {
      const screen = (await VENUE_SERVICE.readDeviceKitchenScreens(tx, k.v.cfg, by.deviceId)).find(
        (candidate) => candidate.kind === "pass",
      )!;
      return readScopedPassBoard(tx, k.v.cfg, passScopeOf(screen));
    });
    expect(JSON.stringify(board.toFire)).toContain(desserts!);
    expect(JSON.stringify(board)).not.toContain("goesWithKitchenFood");
  });
});
