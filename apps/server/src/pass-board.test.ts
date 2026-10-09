import { createZone } from "./testing/service-zone.js";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  deviceProfiles,
  devices,
  passItemMarks,
  ticketItems,
  workingOrderLines,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createCourse, createStation, setProductCourse } from "./kitchen.js";
import { routeProductTo } from "./testing/zone-offers.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  inTx,
  orderForParty,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import {
  listPassMonitor,
  listPassScreen,
  markPassItems,
  passSees,
  type PassScope,
} from "./pass-board.js";
import {
  carveOffLines,
  createOpenOrder,
  fireableLineColumns,
  fireLines,
  listExpoQueue,
} from "./working-order.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const EVERY: PassScope = { stationIds: null, zoneIds: null };

async function passDevices(v: PartyVenue, count: number): Promise<string[]> {
  return inTx(v, async (tx) => {
    const [profile] = await tx
      .insert(deviceProfiles)
      .values({ name: `Pass ${randomUUID()}`, formFactor: "kds" })
      .returning({ id: deviceProfiles.id });
    const rows = await tx
      .insert(devices)
      .values(
        Array.from({ length: count }, (_, n) => ({
          locationId: v.cfg.locationId,
          deviceProfileId: profile!.id,
          label: `Pass screen ${n + 1} ${randomUUID()}`,
          tokenHash: randomUUID(),
        })),
      )
      .returning({ id: devices.id });
    return rows.map((row) => row.id);
  });
}

type Board = { orders: { orderId: string; courses: Part[]; groups: Part[] }[] };
type Part = { items: { id: string; name: string }[] };
const names = (board: Board) =>
  board.orders.flatMap((o) =>
    [...o.courses, ...o.groups].flatMap((p) => p.items.map((i) => i.name)),
  );
const ids = (board: Board) =>
  board.orders.flatMap((o) => [...o.courses, ...o.groups].flatMap((p) => p.items.map((i) => i.id)));

/** A Grill and a Bar station, a Terrace zone, and three fired orders: Burger and Caña on the
 *  terrace, Burger inside, and a Burger counter sale. */
async function terraceVenue() {
  const v = await setupPartyVenue(suite.db);
  const { grill, bar, terrace } = await inTx(v, async (tx) => {
    const grill = (await createStation(tx, v.cfg, { name: "Grill" })).id;
    const bar = (await createStation(tx, v.cfg, { name: "Bar" })).id;
    await routeProductTo(tx, v.cfg, v.productId("Burger"), grill);
    await routeProductTo(tx, v.cfg, v.productId("Caña"), bar);
    const terrace = (await createZone(tx, v.cfg, { name: "Terrace" })).id;
    await offerProducts(tx, v.cfg, { zone: { zoneId: terrace }, serviceMode: "table_tab" });
    return { grill, bar, terrace };
  });
  const outside = await seat(v, await v.table("Outside", terrace));
  const inside = await seat(v, await v.table("Inside"));
  await orderForParty(v, outside.partyId, ["Burger", "Caña"], outside.tabId);
  await orderForParty(v, inside.partyId, ["Burger"], inside.tabId);
  const counterId = randomUUID();
  await inTx(v, async (tx) => {
    await createOpenOrder(
      tx,
      v.cfg,
      counterId,
      v.counter.toOfferLines([{ productId: v.productId("Burger"), quantity: "1" }]),
      null,
      { zoneId: v.counter.zoneId },
    );
    const lines = await tx
      .select(fireableLineColumns)
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, counterId));
    await fireLines(tx, v.cfg, counterId, lines);
  });
  return { v, grill, bar, terrace, outside, inside, counterId };
}

/** Caña at a Bar station in a Starters course, Burger at a Grill station in a Mains course; a
 *  fired counter order of both, and a seated party that sent each in a group of its own. */
async function twoSectionVenue() {
  const v = await setupPartyVenue(suite.db);
  const grill = await inTx(v, async (tx) => {
    const grill = (await createStation(tx, v.cfg, { name: "Grill" })).id;
    const bar = (await createStation(tx, v.cfg, { name: "Bar" })).id;
    await routeProductTo(tx, v.cfg, v.productId("Burger"), grill);
    await routeProductTo(tx, v.cfg, v.productId("Caña"), bar);
    const starters = await createCourse(tx, v.cfg, { name: "Starters", displayOrder: 0 });
    await setProductCourse(tx, v.cfg, v.productId("Caña"), starters.id);
    const mains = await createCourse(tx, v.cfg, { name: "Mains", displayOrder: 1 });
    await setProductCourse(tx, v.cfg, v.productId("Burger"), mains.id);
    return grill;
  });
  const counterId = randomUUID();
  await inTx(v, async (tx) => {
    await createOpenOrder(
      tx,
      v.cfg,
      counterId,
      v.counter.toOfferLines([
        { productId: v.productId("Caña"), quantity: "1" },
        { productId: v.productId("Burger"), quantity: "1" },
      ]),
      null,
      { zoneId: v.counter.zoneId },
    );
    const lines = await tx
      .select(fireableLineColumns)
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, counterId));
    await fireLines(tx, v.cfg, counterId, lines);
  });
  const party = await seat(v, await v.table("Two groups"));
  await orderForParty(v, party.partyId, ["Burger"], party.tabId);
  await orderForParty(v, party.partyId, ["Caña"], party.tabId);
  return { v, grill, counterId, party };
}

type Sections = {
  orders: {
    orderId: string;
    courses: { courseName: string | null; items: { name: string }[] }[];
    groups: { items: { name: string }[] }[];
  }[];
};
const sections = (board: Sections) =>
  Object.fromEntries(
    board.orders.map((o) => [
      o.orderId,
      {
        courses: o.courses.map((c) => [c.courseName, c.items.map((i) => i.name)]),
        groups: o.groups.map((g) => g.items.map((i) => i.name)),
      },
    ]),
  );

describe("passSees", () => {
  it("sees a dish only at a listed station and in a listed zone; a dish in no zone only under every zone", () => {
    const scope: PassScope = { stationIds: ["grill"], zoneIds: ["terrace"] };
    expect(passSees(scope, { stationId: "grill", zoneId: "terrace" })).toBe(true);
    expect(passSees(scope, { stationId: "bar", zoneId: "terrace" })).toBe(false);
    expect(passSees(scope, { stationId: "grill", zoneId: "inside" })).toBe(false);
    expect(passSees(scope, { stationId: "grill", zoneId: null })).toBe(false);
    expect(passSees(EVERY, { stationId: "bar", zoneId: null })).toBe(true);
  });
});

describe("pass screen", () => {
  it("a Terrace-only pass screen lists neither a Bar dish nor an inside order nor a counter sale", async () => {
    const { v, grill, terrace, outside, inside, counterId } = await terraceVenue();
    const [device] = await passDevices(v, 1);
    const every = await inTx(v, (tx) => listPassScreen(tx, v.cfg, device!, EVERY));
    expect(every.orders.map((o) => o.orderId).sort()).toEqual(
      [outside.tabId, inside.tabId, counterId].sort(),
    );
    expect(names(every).sort()).toEqual(["BURG", "BURG", "BURG", "CANA"]);
    const terraceGrill = await inTx(v, (tx) =>
      listPassScreen(tx, v.cfg, device!, { stationIds: [grill], zoneIds: [terrace] }),
    );
    expect(terraceGrill.orders.map((o) => o.orderId)).toEqual([outside.tabId]);
    expect(names(terraceGrill)).toEqual(["BURG"]);
    expect(terraceGrill.orders[0]!.groups[0]).toMatchObject({ allReady: false });
    expect(
      (await inTx(v, (tx) => listPassScreen(tx, v.cfg, device!, { stationIds: [], zoneIds: null })))
        .orders,
    ).toEqual([]);
  });

  it("neither a pass screen nor a pass monitor lists a dish made at the till, nor one of an abandoned or collected order", async () => {
    const { v, outside, inside, counterId } = await terraceVenue();
    const [device] = await passDevices(v, 1);
    const orderIds = async () => ({
      screen: (await inTx(v, (tx) => listPassScreen(tx, v.cfg, device!, EVERY))).orders
        .map((o) => o.orderId)
        .sort(),
      monitor: (await inTx(v, (tx) => listPassMonitor(tx, v.cfg, EVERY))).orders
        .map((o) => o.orderId)
        .sort(),
    });
    const all = [outside.tabId, inside.tabId, counterId].sort();
    expect(await orderIds()).toEqual({ screen: all, monitor: all });
    await suite.db
      .update(ticketItems)
      .set({ madeHere: true })
      .where(eq(ticketItems.workingOrderId, outside.tabId));
    await suite.db.execute(
      sql`update working_orders set status = 'abandoned' where id = ${inside.tabId}`,
    );
    await suite.db.execute(
      sql`update working_orders set collected_at = '2026-10-02T18:00:00.000Z' where id = ${counterId}`,
    );
    expect(await orderIds()).toEqual({ screen: [], monitor: [] });
  });

  it("Done on one device leaves the dish on another, and undoing removes only that device's mark", async () => {
    const { v, grill, outside } = await terraceVenue();
    const [a, b] = await passDevices(v, 2);
    const [burger] = await inTx(v, (tx) =>
      tx
        .select()
        .from(ticketItems)
        .where(
          and(eq(ticketItems.workingOrderId, outside.tabId), eq(ticketItems.stationId, grill)),
        ),
    );
    const read = (device: string) => inTx(v, (tx) => listPassScreen(tx, v.cfg, device, EVERY));
    const expoBefore = await inTx(v, (tx) => listExpoQueue(tx, v.cfg));
    const at = new Date("2026-10-01T12:00:00.000Z");
    await inTx(v, (tx) =>
      markPassItems(tx, v.cfg, { deviceId: a!, personId: null }, EVERY, [burger!.id], true, at),
    );
    expect(ids(await read(a!))).not.toContain(burger!.id);
    expect(ids(await read(b!))).toContain(burger!.id);
    expect(await inTx(v, (tx) => listExpoQueue(tx, v.cfg))).toEqual(expoBefore);
    const person = randomUUID();
    await inTx(v, (tx) =>
      markPassItems(tx, v.cfg, { deviceId: b!, personId: person }, EVERY, [burger!.id], true, at),
    );
    const both = await inTx(v, (tx) =>
      tx.select().from(passItemMarks).where(eq(passItemMarks.ticketItemId, burger!.id)),
    );
    expect(both).toHaveLength(2);
    expect(both).toEqual(
      expect.arrayContaining([
        { deviceId: a, ticketItemId: burger!.id, doneAt: at.toISOString(), doneByPersonId: null },
        { deviceId: b, ticketItemId: burger!.id, doneAt: at.toISOString(), doneByPersonId: person },
      ]),
    );
    await inTx(v, (tx) =>
      markPassItems(
        tx,
        v.cfg,
        { deviceId: a!, personId: randomUUID() },
        EVERY,
        [burger!.id],
        false,
        at,
      ),
    );
    expect(ids(await read(a!))).toContain(burger!.id);
    expect(ids(await read(b!))).not.toContain(burger!.id);
    expect(
      await inTx(v, (tx) =>
        tx.select().from(passItemMarks).where(eq(passItemMarks.ticketItemId, burger!.id)),
      ),
    ).toEqual([
      { deviceId: b, ticketItemId: burger!.id, doneAt: at.toISOString(), doneByPersonId: person },
    ]);
  });

  it("keeps a device's Done mark on a ticket item copied by a quantity split", async () => {
    const v = await setupPartyVenue(suite.db);
    const [device, other] = await passDevices(v, 2);
    const party = await seat(v, await v.table("Split table"));
    await orderForParty(v, party.partyId, ["Burger"], party.tabId);
    const [item] = await inTx(v, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, party.tabId)),
    );
    await inTx(v, async (tx) => {
      await tx
        .update(workingOrderLines)
        .set({ quantity: 2000 })
        .where(eq(workingOrderLines.id, item!.workingOrderLineId));
      await tx.update(ticketItems).set({ quantity: 2000 }).where(eq(ticketItems.id, item!.id));
      await markPassItems(
        tx,
        v.cfg,
        { deviceId: device!, personId: null },
        EVERY,
        [item!.id],
        true,
        new Date(),
      );
      await carveOffLines(tx, v.cfg, party.tabId, party.tabId, [{ lineNo: 1, quantity: "1" }], {
        refuseHeld: false,
      });
    });
    const itemIds = (
      await inTx(v, (tx) =>
        tx
          .select({ id: ticketItems.id })
          .from(ticketItems)
          .where(eq(ticketItems.workingOrderId, party.tabId)),
      )
    ).map((row) => row.id);
    expect(itemIds).toHaveLength(2);
    const marks = await inTx(v, (tx) =>
      tx.select().from(passItemMarks).where(eq(passItemMarks.deviceId, device!)),
    );
    expect(new Set(marks.map((mark) => mark.ticketItemId))).toEqual(new Set(itemIds));
    expect((await inTx(v, (tx) => listPassScreen(tx, v.cfg, device!, EVERY))).orders).toEqual([]);
    expect(ids(await inTx(v, (tx) => listPassScreen(tx, v.cfg, other!, EVERY))).sort()).toEqual(
      [...itemIds].sort(),
    );
  });
});

describe("a pass's sections", () => {
  it("a pass screen leaves out a course or group holding no dish it shows", async () => {
    const { v, grill, counterId, party } = await twoSectionVenue();
    const [device] = await passDevices(v, 1);
    const read = () =>
      inTx(v, (tx) => listPassScreen(tx, v.cfg, device!, { stationIds: [grill], zoneIds: null }));
    expect(sections(await read())).toEqual({
      [counterId]: { courses: [["Mains", ["BURG"]]], groups: [] },
      [party.tabId]: { courses: [], groups: [["BURG"]] },
    });
    const everything = sections(await inTx(v, (tx) => listPassScreen(tx, v.cfg, device!, EVERY)));
    expect(everything[counterId]!.courses).toEqual([
      ["Starters", ["CANA"]],
      ["Mains", ["BURG"]],
    ]);
    expect(everything[party.tabId]!.groups).toEqual([["BURG"], ["CANA"]]);
  });

  it("a pass monitor leaves out a course or group holding no dish in its scope", async () => {
    const { v, grill, counterId, party } = await twoSectionVenue();
    const board = await inTx(v, (tx) =>
      listPassMonitor(tx, v.cfg, { stationIds: [grill], zoneIds: null }),
    );
    expect(sections(board)).toEqual({
      [counterId]: { courses: [["Mains", ["BURG"]]], groups: [] },
      [party.tabId]: { courses: [], groups: [["BURG"]] },
    });
  });

  it("a pass monitor drops a course whose dishes are all away and keeps the order's waiting course", async () => {
    const { v, grill, counterId } = await twoSectionVenue();
    const counterItems = await inTx(v, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, counterId)),
    );
    const starter = counterItems.find((item) => item.stationId !== grill)!;
    await inTx(v, (tx) =>
      tx
        .update(ticketItems)
        .set({ awayAt: new Date().toISOString() })
        .where(eq(ticketItems.id, starter.id)),
    );
    const board = await inTx(v, (tx) => listPassMonitor(tx, v.cfg, EVERY));
    expect(sections(board)[counterId]).toEqual({ courses: [["Mains", ["BURG"]]], groups: [] });
  });
});

describe("markPassItems", () => {
  it("writes and refuses nothing for an id that names no dish", async () => {
    const v = await setupPartyVenue(suite.db);
    const [device] = await passDevices(v, 1);
    for (const done of [true, false]) {
      await inTx(v, (tx) =>
        markPassItems(
          tx,
          v.cfg,
          { deviceId: device!, personId: null },
          { stationIds: null, zoneIds: [v.counter.zoneId] },
          [randomUUID()],
          done,
          new Date(),
        ),
      );
    }
    expect(await inTx(v, (tx) => tx.select().from(passItemMarks))).toEqual([]);
  });
});

describe("pass monitor", () => {
  it("lists its scope's dishes, keeps no marks, and drops a section whose dishes are all away", async () => {
    const { v, grill, terrace, outside, inside, counterId } = await terraceVenue();
    const [device] = await passDevices(v, 1);
    const grillOnly: PassScope = { stationIds: [grill], zoneIds: null };
    const read = (scope: PassScope) => inTx(v, (tx) => listPassMonitor(tx, v.cfg, scope));
    const before = await read(grillOnly);
    expect(before.orders.map((o) => o.orderId).sort()).toEqual(
      [outside.tabId, inside.tabId, counterId].sort(),
    );
    expect(names(before)).toEqual(["BURG", "BURG", "BURG"]);
    expect(before.orders[0]!.groups[0] ?? before.orders[0]!.courses[0]).not.toHaveProperty(
      "allReady",
    );
    const terraceOnly = await read({ stationIds: null, zoneIds: [terrace] });
    expect(terraceOnly.orders.map((o) => o.orderId)).toEqual([outside.tabId]);
    expect(names(terraceOnly).sort()).toEqual(["BURG", "CANA"]);

    const [burger] = await inTx(v, (tx) =>
      tx
        .select()
        .from(ticketItems)
        .where(
          and(eq(ticketItems.workingOrderId, outside.tabId), eq(ticketItems.stationId, grill)),
        ),
    );
    await inTx(v, (tx) =>
      markPassItems(
        tx,
        v.cfg,
        { deviceId: device!, personId: null },
        EVERY,
        [burger!.id],
        true,
        new Date(),
      ),
    );
    expect(await read(grillOnly)).toEqual(before);

    await inTx(v, (tx) =>
      tx
        .update(ticketItems)
        .set({ awayAt: new Date().toISOString() })
        .where(eq(ticketItems.id, burger!.id)),
    );
    expect((await inTx(v, (tx) => listExpoQueue(tx, v.cfg))).map((o) => o.orderId)).toContain(
      outside.tabId,
    );
    expect((await read(grillOnly)).orders.map((o) => o.orderId).sort()).toEqual(
      [inside.tabId, counterId].sort(),
    );
    expect(ids(await read(EVERY))).toContain(burger!.id);
  });

  it("limited to the counter's zone, lists the counter sale and no table's order", async () => {
    const { v, counterId } = await terraceVenue();
    const board = await inTx(v, (tx) =>
      listPassMonitor(tx, v.cfg, { stationIds: null, zoneIds: [v.counter.zoneId] }),
    );
    expect(board.orders.map((o) => o.orderId)).toEqual([counterId]);
    expect(names(board)).toEqual(["BURG"]);
  });
});
