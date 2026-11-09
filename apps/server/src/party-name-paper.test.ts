import { fireGroup } from "./order-groups.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import * as printing from "@waitron/printing";
import { joinTables } from "./testing/table-action-fixture.js";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  kitchenStations,
  orderGroups,
  parties,
  locations,
  printJobs,
  printers,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPrinter } from "@waitron/printing";
import { writeContentLanguages } from "@waitron/catalogue";
import { kitchenTicketWords } from "./i18n/kitchen-ticket.js";
import { attachPrinterToStation } from "./station-printers.js";
import { createStation } from "./kitchen.js";
import { routeProductTo } from "./testing/zone-offers.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { setStationPrinting } from "./testing/station-printing.js";
import { printedLines } from "./testing/decode-ticket.js";
import {
  commandFor,
  revisionOf,
  inTx,
  nameParty,
  OPERATOR,
  order,
  pay,
  seatWithNoAllergies as seat,
  setupPartyVenue,
  split,
  type PartyVenue,
} from "./testing/party-venue.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let v: PartyVenue;
let stationId: string;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-17T12:30:00Z"));
  v = await setupPartyVenue(suite.db);
  stationId = (await v.db.select({ id: kitchenStations.id }).from(kitchenStations))[0]!.id;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function printer(stations = [stationId], paperWidth: "58mm" | "80mm" = "80mm") {
  return inTx(v, async (tx) => {
    const p = await createPrinter(tx, {
      name: "Kitchen",
      transport: "cloud_poll",
      pollId: randomUUID(),
      paperWidth,
    });
    for (const id of stations) await attachPrinterToStation(tx, { stationId: id, printerId: p.id });
    return p.id;
  });
}
const jobs = () => v.db.select().from(printJobs);
async function rename(partyId: string, name: string) {
  const old = await jobs();
  await nameParty(v, partyId, name);
  const after = await jobs();
  expect(after.filter((job) => old.some((before) => before.id === job.id))).toEqual(old);
  return after.filter((job) => !old.some((before) => before.id === job.id));
}
async function numbers(ids: string[]) {
  return (
    await v.db
      .select({ number: workingOrders.orderNumber })
      .from(workingOrders)
      .where(inArray(workingOrders.id, ids))
  )
    .map((row) => row.number)
    .sort((a, b) => a - b)
    .join(", ");
}

it.each(["en", "es"] as const)(
  "first naming identifies both bills in %s at both widths",
  async (language) => {
    const narrow = await printer([stationId], "58mm");
    const wide = await printer();
    await inTx(v, (tx) =>
      writeContentLanguages(tx, { defaultLanguage: language, languages: ["en", "es"] }),
    );
    const p = await seat(v, await v.table("Table 4"));
    await order(v, p.tabId, "Burger", "Burger");
    const second = await split(v, p.partyId, p.tabId, [2]);
    const out = await rename(p.partyId, "Ann");
    expect(out.map((job) => job.printerId).sort()).toEqual([narrow, wide].sort());
    const words = kitchenTicketWords(language);
    for (const job of out) {
      const lines = printedLines(job.payload);
      expect(lines).toEqual([
        `*** ${words.nameChanged} ***`,
        (await v.db.select().from(kitchenStations))[0]!.name,
        "Table 4",
        `${words.orders} ${await numbers([p.tabId, second])}`,
        "14:30",
        `${words.was}: ${words.unnamed}`,
        `${words.now}: Ann`,
        "",
      ]);
    }
  },
);

it.each(["Bea", ""])("renames Ann to '%s' without repeating cooking work", async (name) => {
  await printer();
  const p = await seat(v, await v.table("Table 4"));
  await nameParty(v, p.partyId, "Ann");
  await order(v, p.tabId, "Burger");
  const before = await v.db.select().from(ticketItems);
  const out = await rename(p.partyId, name);
  expect(out).toHaveLength(1);
  const words = kitchenTicketWords("es");
  expect(printedLines(out[0]!.payload)).toEqual([
    `*** ${words.nameChanged} ***`,
    (await v.db.select().from(kitchenStations))[0]!.name,
    "Table 4",
    `${words.order} ${await numbers([p.tabId])}`,
    "14:30",
    `${words.was}: Ann`,
    `${words.now}: ${name || words.unnamed}`,
    "",
  ]);
  expect(await v.db.select().from(ticketItems)).toEqual(before);
});

it("does not print an unchanged normalized name", async () => {
  await printer();
  const p = await seat(v, await v.table("Table 4"));
  await nameParty(v, p.partyId, "Ann");
  await order(v, p.tabId, "Burger");
  expect(await rename(p.partyId, " Ann ")).toEqual([]);
});

it.each(["none", "served", "made-here", "collected", "abandoned"] as const)(
  "does not rename %s work",
  async (kind) => {
    await printer();
    const p = await seat(v, await v.table("Table 4"));
    if (kind !== "none") await order(v, p.tabId, "Burger");
    await inTx(v, async (tx) => {
      if (kind === "served")
        await tx
          .update(workingOrderLines)
          .set({ servedAt: new Date().toISOString(), servedQuantity: 1000 })
          .where(eq(workingOrderLines.workingOrderId, p.tabId));
      if (kind === "made-here")
        await tx
          .update(ticketItems)
          .set({ madeHere: true })
          .where(eq(ticketItems.workingOrderId, p.tabId));
      if (kind === "collected")
        await tx
          .update(workingOrders)
          .set({ collectedAt: new Date().toISOString() })
          .where(eq(workingOrders.id, p.tabId));
      if (kind === "abandoned")
        await tx
          .update(workingOrders)
          .set({ status: "abandoned" })
          .where(eq(workingOrders.id, p.tabId));
    });
    expect(await rename(p.partyId, "Ann")).toEqual([]);
  },
);

it.each([true, false])(
  "renames HOLD work only if its station recorded paper (%s)",
  async (recorded) => {
    await printer();
    await inTx(v, (tx) => setStationPrinting(tx, { printHeldWork: recorded }));
    const p = await seat(v, await v.table("Table 4"));
    await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, p.partyId, {
        operatorId: OPERATOR,
        groups: [{ release: "hold", lines: [{ menuItemId: v.item("Burger"), quantity: "1" }] }],
      }),
    );
    expect(await rename(p.partyId, "Ann")).toHaveLength(recorded ? 1 : 0);
  },
);

it("names paid but unserved work in the current saved venue zone", async () => {
  await printer();
  const p = await seat(v, await v.table("Table 4"));
  await order(v, p.tabId, "Burger");
  await pay(v, p.tabId, "12.00");
  await inTx(v, (tx) => tx.update(locations).set({ timeZone: "Asia/Tokyo" }));
  const out = await rename(p.partyId, "Ann");
  expect(out).toHaveLength(1);
  expect(printedLines(out[0]!.payload)).toContain("21:30");
});

it("lists only the bills represented at each printer and excludes an inactive printer", async () => {
  const bar = await inTx(v, (tx) => createStation(tx, { name: "Bar" }));
  await inTx(v, (tx) => routeProductTo(tx, v.productId("Agua"), bar.id));
  const shared = await printer([stationId, bar.id]);
  const barOnly = await printer([bar.id]);
  const off = await printer();
  const p = await seat(v, await v.table("Table 4"));
  await order(v, p.tabId, "Burger", "Agua");
  const second = await split(v, p.partyId, p.tabId, [2]);
  await inTx(v, (tx) => tx.update(printers).set({ active: false }).where(eq(printers.id, off)));
  const out = await rename(p.partyId, "Ann");
  expect(out).toHaveLength(2);
  const words = kitchenTicketWords("es");
  expect(printedLines(out.find((job) => job.printerId === shared)!.payload)).toContain(
    `${words.orders} ${await numbers([p.tabId, second])}`,
  );
  expect(printedLines(out.find((job) => job.printerId === barOnly)!.payload)).toContain(
    `${words.order} ${await numbers([second])}`,
  );
});

it("renames retained paid work under the surviving party after a merge", async () => {
  await printer();
  const tableId = await v.table("Table 4");
  const source = await seat(v, tableId);
  await order(v, source.tabId, "Burger");
  await pay(v, source.tabId, "12.00");
  const target = await seat(v, await v.table("Table 5"));
  await nameParty(v, target.partyId, "Ann");
  const expected = await commandFor(v, target.partyId);
  const expectedOtherPartyRevision = await revisionOf(v, source.partyId);
  await inTx(v, (tx) =>
    joinTables(tx, v.cfg, target.partyId, tableId, {
      ...expected,
      otherPartyId: source.partyId,
      expectedOtherPartyRevision,
    }),
  );
  const out = await rename(target.partyId, "Bea");
  expect(out).toHaveLength(1);
  const words = kitchenTicketWords("es");
  expect(printedLines(out[0]!.payload)).toContain(
    `${words.order} ${await numbers([source.tabId])}`,
  );
  expect(printedLines(out[0]!.payload)).toContain(`${words.was}: Ann`);
  expect(printedLines(out[0]!.payload)).toContain(`${words.now}: Bea`);
});

it("rolls back the name and revision when the paper cannot be queued", async () => {
  await printer();
  const p = await seat(v, await v.table("Table 4"));
  await order(v, p.tabId, "Burger");
  const before = await v.db.select().from(parties);
  const paper = await jobs();
  vi.spyOn(printing, "enqueuePrintJob").mockRejectedValueOnce(new Error("name paper refused"));
  await expect(nameParty(v, p.partyId, "Ann")).rejects.toThrow("name paper refused");
  expect(await v.db.select().from(parties)).toEqual(before);
  expect(await jobs()).toEqual(paper);
});

it("renames only the station whose HOLD paper was recorded", async () => {
  const bar = await inTx(v, (tx) => createStation(tx, { name: "Bar" }));
  await inTx(v, (tx) => routeProductTo(tx, v.productId("Agua"), bar.id));
  await printer([stationId]);
  const barOnly = await printer([bar.id]);
  await inTx(v, (tx) => setStationPrinting(tx, { printHeldWork: true }, [stationId]));
  const p = await seat(v, await v.table("Table 4"));
  await inTx(v, (tx) =>
    placeGroups(tx, v.cfg, p.partyId, {
      operatorId: OPERATOR,
      groups: [
        {
          release: "hold",
          lines: ["Burger", "Agua"].map((name) => ({ menuItemId: v.item(name), quantity: "1" })),
        },
      ],
    }),
  );
  const out = await rename(p.partyId, "Ann");
  expect(out).toHaveLength(1);
  expect(out[0]!.printerId).not.toBe(barOnly);
});

it.each([true, false])(
  "F1 names work waiting at the pass only with recorded HOLD paper (%s)",
  async (recorded) => {
    await printer();
    await inTx(v, (tx) => setStationPrinting(tx, { printHeldWork: recorded }));
    await inTx(v, (tx) => setStationsWaitForPass(tx, true, [stationId]));
    const p = await seat(v, await v.table("Waiting"));
    await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, p.partyId, {
        operatorId: OPERATOR,
        billId: p.tabId,
        groups: [{ release: "hold", lines: [{ menuItemId: v.item("Burger"), quantity: "1" }] }],
      }),
    );
    const [group] = await v.db.select().from(orderGroups);
    const expected = await commandFor(v, p.partyId);
    await inTx(v, (tx) =>
      fireGroup(tx, v.cfg, p.partyId, group!.id, { ...expected, submissionId: randomUUID() }),
    );
    const [work] = await v.db.select().from(ticketItems);
    expect(work!.requestedAt).not.toBeNull();
    expect(work!.firedAt).toBeNull();
    const out = await rename(p.partyId, "Ann");
    expect(out).toHaveLength(recorded ? 1 : 0);
    if (recorded)
      expect(printedLines(out[0]!.payload)).toContain(`${kitchenTicketWords("es").now}: Ann`);
  },
);
