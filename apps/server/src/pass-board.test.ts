import { createZone } from "./testing/service-zone.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deviceProfiles, ticketItems, workingOrderLines } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice } from "@waitron/db/testing/seed.js";
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
import { passSees, readScopedPassBoard, type PassScope } from "./pass-board.js";
import type { PassBoard, PassCard } from "./pass-card.js";
import {
  boardCards,
  boardItems,
  boardOrderIds,
  cardOf,
  EVERY,
} from "./testing/pass-board-probe.js";
import { carveOffLines, createOpenOrder, fireableLineColumns, fireLines } from "./working-order.js";
import { mountDeviceApi } from "./device-api.js";
import { createPairingMode } from "./pairing-mode.js";
import { DEVICE_COOKIE } from "./device-session.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

async function passDevices(v: PartyVenue, count: number): Promise<string[]> {
  return inTx(v, async (tx) => {
    const [profile] = await tx
      .insert(deviceProfiles)
      .values({ name: `Pass ${randomUUID()}`, formFactor: "kds" })
      .returning({ id: deviceProfiles.id });
    const deviceIds: string[] = [];
    for (let n = 0; n < count; n++) {
      const label = `Pass screen ${n + 1} ${randomUUID()}`;
      deviceIds.push((await seedDevice(tx, { label, profileId: profile!.id })).deviceId);
    }
    return deviceIds;
  });
}

/** The dishes the board's scope sees. */
const names = (board: PassBoard) => boardItems(board, { inView: true }).map((i) => i.name);
const ids = (board: PassBoard) => boardItems(board, { inView: true }).map((i) => i.id);
const read = (v: PartyVenue, scope: PassScope) => inTx(v, (tx) => readScopedPassBoard(tx, scope));

/** A Grill and a Bar station, a Terrace zone, and three fired orders: Burger and Caña on the
 *  terrace, Burger inside, and a Burger counter sale. */
async function terraceVenue() {
  const v = await setupPartyVenue(suite.db);
  const { grill, bar, terrace } = await inTx(v, async (tx) => {
    const grill = (await createStation(tx, { name: "Grill" })).id;
    const bar = (await createStation(tx, { name: "Bar" })).id;
    await routeProductTo(tx, v.productId("Burger"), grill);
    await routeProductTo(tx, v.productId("Caña"), bar);
    const terrace = (await createZone(tx, { name: "Terrace" })).id;
    await offerProducts(tx, v.cfg, { zone: { zoneId: terrace }, orderStart: "table" });
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
    const grill = (await createStation(tx, { name: "Grill" })).id;
    const bar = (await createStation(tx, { name: "Bar" })).id;
    await routeProductTo(tx, v.productId("Burger"), grill);
    await routeProductTo(tx, v.productId("Caña"), bar);
    const starters = await createCourse(tx, { name: "Starters", displayOrder: 0 });
    await setProductCourse(tx, v.productId("Caña"), starters.id);
    const mains = await createCourse(tx, { name: "Mains", displayOrder: 1 });
    await setProductCourse(tx, v.productId("Burger"), mains.id);
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

/** A card's dishes in order, each with whether the board's scope sees it. */
const dishes = (card: PassCard) => card.items.map((i) => [i.name, i.visible]);
const billCard = (board: PassBoard, orderId: string) =>
  cardOf(board, (c) => c.target.kind === "bill" && c.target.workingOrderId === orderId);
const groupCards = (board: PassBoard) =>
  boardCards(board)
    .filter((c) => c.target.kind === "group")
    .sort((a, b) => a.group!.position - b.group!.position);

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
    const every = await read(v, EVERY);
    expect(boardOrderIds(every)).toEqual([outside.tabId, inside.tabId, counterId].sort());
    expect(names(every).sort()).toEqual(["BURG", "BURG", "BURG", "CANA"]);
    const terraceGrill = await read(v, { stationIds: [grill], zoneIds: [terrace] });
    expect(boardOrderIds(terraceGrill, { inView: true })).toEqual([outside.tabId]);
    expect(names(terraceGrill)).toEqual(["BURG"]);
    expect(boardCards(terraceGrill)[0]).toMatchObject({ allReady: false });
    expect(boardCards(await read(v, { stationIds: [], zoneIds: null }))).toEqual([]);
  });

  it("neither a pass screen nor a pass monitor lists a dish made at the till, nor one of an abandoned or collected order", async () => {
    const { v, outside, inside, counterId } = await terraceVenue();
    const orderIds = async () => boardOrderIds(await read(v, EVERY));
    expect(await orderIds()).toEqual([outside.tabId, inside.tabId, counterId].sort());
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
    expect(await orderIds()).toEqual([]);
  });

  it("A773 no dispatch state: splitting a dish keeps both its kitchen items on the pass", async () => {
    const v = await setupPartyVenue(suite.db);
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
      await carveOffLines(tx, v.cfg, party.tabId, party.tabId, [{ lineNo: 1, quantity: "1" }], {});
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
    expect(ids(await read(v, EVERY)).sort()).toEqual([...itemIds].sort());
  });
});

describe("a pass's sections", () => {
  it("a pass screen leaves out a group card holding no dish it shows, and shows a bill's card whole", async () => {
    const { v, grill, counterId } = await twoSectionVenue();
    const grillOnly = await read(v, { stationIds: [grill], zoneIds: null });
    expect(dishes(billCard(grillOnly, counterId))).toEqual([
      ["CANA", false],
      ["BURG", true],
    ]);
    expect(groupCards(grillOnly).map(dishes)).toEqual([[["BURG", true]]]);
    expect(boardCards(grillOnly)).toHaveLength(2);
    const everything = await read(v, EVERY);
    expect(dishes(billCard(everything, counterId))).toEqual([
      ["CANA", true],
      ["BURG", true],
    ]);
    expect(groupCards(everything).map(dishes)).toEqual([[["BURG", true]], [["CANA", true]]]);
    expect(boardCards(everything)).toHaveLength(3);
  });
});

describe("the pass board", () => {
  it("lists a card's dishes in no course first, then in course order, whatever order they were sent in", async () => {
    const v = await setupPartyVenue(suite.db);
    await inTx(v, async (tx) => {
      const grill = (await createStation(tx, { name: "Grill" })).id;
      for (const name of ["Burger", "Caña", "Flan"])
        await routeProductTo(tx, v.productId(name), grill);
      const starters = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      await setProductCourse(tx, v.productId("Caña"), starters.id);
      const mains = await createCourse(tx, { name: "Mains", displayOrder: 1 });
      await setProductCourse(tx, v.productId("Burger"), mains.id);
    });
    const counterId = randomUUID();
    await inTx(v, async (tx) => {
      await createOpenOrder(
        tx,
        v.cfg,
        counterId,
        v.counter.toOfferLines(
          ["Burger", "Caña", "Flan"].map((name) => ({
            productId: v.productId(name),
            quantity: "1",
          })),
        ),
        null,
        { zoneId: v.counter.zoneId },
      );
      const lines = await tx
        .select(fireableLineColumns)
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, counterId));
      await fireLines(tx, v.cfg, counterId, lines);
    });
    const board = await inTx(v, (tx) => readScopedPassBoard(tx, EVERY));
    const cards = [...board.held, ...board.toFire, ...board.inProgress, ...board.ready];
    expect(cards.map((card) => card.target)).toEqual([{ kind: "bill", workingOrderId: counterId }]);
    expect(cards[0]!.items.map((item) => item.name)).toEqual(["FLAN", "CANA", "BURG"]);
  });
});

describe("retired pass completion", () => {
  it("refuses Done and Undo for an id that names no dish", async () => {
    const v = await setupPartyVenue(suite.db);
    const [device] = await passDevices(v, 1);
    const app = new Hono();
    mountDeviceApi(
      app,
      { db: suite.db, cfg: v.cfg, secureCookies: false, pairingMode: createPairingMode() },
      () => {},
    );
    for (const done of [true, false]) {
      const response = await app.request("/api/device/pass-screen/done", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${DEVICE_COOKIE}=${device}.invalid`,
        },
        body: JSON.stringify({ ticketItemIds: [randomUUID()], done }),
      });
      expect(response.status).toBe(404);
    }
  });
});

describe("pass monitor", () => {
  it("lists its scoped dishes", async () => {
    const { v, grill, terrace, outside, inside, counterId } = await terraceVenue();
    const grillOnly: PassScope = { stationIds: [grill], zoneIds: null };
    const before = await read(v, grillOnly);
    expect(boardOrderIds(before, { inView: true })).toEqual(
      [outside.tabId, inside.tabId, counterId].sort(),
    );
    expect(names(before)).toEqual(["BURG", "BURG", "BURG"]);
    const terraceOnly = await read(v, { stationIds: null, zoneIds: [terrace] });
    expect(boardOrderIds(terraceOnly, { inView: true })).toEqual([outside.tabId]);
    expect(names(terraceOnly).sort()).toEqual(["BURG", "CANA"]);

    const [burger] = await inTx(v, (tx) =>
      tx
        .select()
        .from(ticketItems)
        .where(
          and(eq(ticketItems.workingOrderId, outside.tabId), eq(ticketItems.stationId, grill)),
        ),
    );

    expect(boardOrderIds(await read(v, EVERY))).toContain(outside.tabId);
    expect(boardOrderIds(await read(v, grillOnly), { inView: true })).toEqual(
      [outside.tabId, inside.tabId, counterId].sort(),
    );
    expect(ids(await read(v, EVERY))).toContain(burger!.id);
  });

  it("limited to the counter's zone, lists the counter sale and no table's order", async () => {
    const { v, counterId } = await terraceVenue();
    const board = await read(v, { stationIds: null, zoneIds: [v.counter.zoneId] });
    expect(boardOrderIds(board, { inView: true })).toEqual([counterId]);
    expect(names(board)).toEqual(["BURG"]);
  });
});
