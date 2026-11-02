import { randomUUID } from "node:crypto";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  deviceProfiles,
  floorZones,
  parties,
  printJobs,
  ticketItems,
  withTransaction,
  workingOrderLines,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { DeviceKitchenScreen } from "@waitron/module";
import {
  fireNewOrder,
  setupSplitExtrasVenue,
  useSplitExtrasDb,
} from "./testing/split-extras-venue.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import { OPERATOR } from "./testing/party-venue.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { routeProductTo } from "./testing/zone-offers.js";
import { createStation } from "./kitchen.js";
import { VENUE_SERVICE } from "./modules.js";
import { passScopeOf, readPassCardRows, readScopedPassBoard } from "./pass-board.js";
import { passCardRelease, type PassCard } from "./pass-card.js";
import { fireOrderLines, markServed, routingOnce } from "./working-order.js";
import { passReleaseAsk, releasePassItems, type PassActor } from "./pass-release.js";
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
  vi.useRealTimers();
});

const AT = "2026-03-14T12:00:00.000Z";
const LATER = "2026-03-14T12:05:00.000Z";

type Venue = Awaited<ReturnType<typeof setupSplitExtrasVenue>>;

const dish = (venue: Venue, product: "burger" | "cheese", chips = false) => ({
  menuItemId: venue.tables.offerFor(venue.products[product]),
  quantity: "1",
  ...(chips
    ? {
        extras: [
          {
            listId: venue.lists.burger,
            picks: [{ productId: venue.products.chips, quantity: 1 }],
          },
        ],
      }
    : {}),
});

async function ticketItemOf(tx: Transaction, lineId: string): Promise<string> {
  const [row] = await tx
    .select({ id: ticketItems.id })
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderLineId, lineId));
  return row!.id;
}

/** A device with its own kitchen profile, which may run the pass. */
async function device(
  venue: Venue,
  name: string,
  choice: { kitchenScreen?: DeviceKitchenScreen; stationId?: string },
): Promise<PassActor> {
  const [profile] = await withTransaction(db, (tx) =>
    tx
      .insert(deviceProfiles)
      .values({
        name: `${name} profile`,
        formFactor: "kds",
        capabilities: ["act-as-kds", "prepare-orders", "run-the-pass"],
      })
      .returning({ id: deviceProfiles.id }),
  );
  const joined = await enrolDeviceForTest(db, venue.cfg, {
    name,
    profileId: profile!.id,
    ...choice,
  });
  return { deviceId: joined.deviceId, personId: null };
}

const passOn = (
  venue: Venue,
  name: string,
  stationIds: string[] | null,
  zoneIds: string[] | null = null,
) => device(venue, name, { kitchenScreen: { kind: "pass", stationIds, zoneIds } });

/** The device's pass screen's To fire cards, read as its board reads them. */
async function toFire(venue: Venue, by: PassActor): Promise<PassCard[]> {
  return withTransaction(db, async (tx) => {
    const screen = (await VENUE_SERVICE.readDeviceKitchenScreens(tx, venue.cfg, by.deviceId)).find(
      (candidate) => candidate.kind === "pass",
    )!;
    return (await readScopedPassBoard(tx, venue.cfg, passScopeOf(screen))).toFire;
  });
}

const askOf = (card: PassCard) => ({
  submissionId: randomUUID(),
  target: card.target,
  ticketItemIds: card.releaseTicketItemIds,
  expectedContext: card.releaseContext,
});

const release = (venue: Venue, by: PassActor, body: unknown) =>
  withTransaction(db, (tx) => releasePassItems(tx, venue.cfg, by, body));

async function rows(ids: string[]) {
  return withTransaction(db, (tx) =>
    tx.select().from(ticketItems).where(inArray(ticketItems.id, ids)).orderBy(asc(ticketItems.id)),
  );
}

async function jobCount(): Promise<number> {
  const [row] = await withTransaction(db, (tx) =>
    tx.select({ count: sql<number>`count(*)` }).from(printJobs),
  );
  return row!.count;
}

/** Refused with `code`, and the named rows and the print jobs as they were. */
async function refusedWhole(
  attempt: Promise<unknown>,
  code: string,
  ids: string[],
  params?: Record<string, unknown>,
) {
  const before = await rows(ids);
  const jobs = await jobCount();
  await expect(attempt).rejects.toMatchObject(params === undefined ? { code } : { code, params });
  expect(await rows(ids)).toEqual(before);
  expect(await jobCount()).toBe(jobs);
}

/** Grill and Cold wait; one Fire now group of a burger (Grill) and a salad (Cold), and a hot and
 *  a cold pass on the party's zone. */
async function hotAndCold() {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
  const venue = await setupSplitExtrasVenue();
  const placed = await withTransaction(db, async (tx) => {
    const cold = (await createStation(tx, venue.cfg, { name: "Cold" })).id;
    await routeProductTo(tx, venue.cfg, venue.products.cheese, cold);
    await setStationsWaitForPass(tx, true, [venue.stations.grill, cold]);
    const group = (
      await placeGroups(tx, venue.cfg, venue.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [dish(venue, "burger"), dish(venue, "cheese")], release: "fire" }],
      })
    ).groups[0]!;
    const [burgerLine, saladLine] = group.lineIds as [string, string];
    return {
      cold,
      groupId: group.id,
      burgerLine,
      burger: await ticketItemOf(tx, burgerLine),
      salad: await ticketItemOf(tx, saladLine),
    };
  });
  const hot = await passOn(venue, "Hot pass", [venue.stations.grill]);
  const coldPass = await passOn(venue, "Cold pass", [placed.cold]);
  return { venue, ...placed, hot, coldPass };
}

function thrown(attempt: () => unknown): unknown {
  try {
    attempt();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("A773 pass release: set and stamps", () => {
  it("releases disjoint sets from a hot and a cold pass on one zone", async () => {
    const f = await hotAndCold();
    const [hotCard] = await toFire(f.venue, f.hot);
    const [coldCard] = await toFire(f.venue, f.coldPass);
    expect(hotCard!.releaseTicketItemIds).toEqual([f.burger]);
    expect(coldCard!.releaseTicketItemIds).toEqual([f.salad]);
    const [burgerBefore, saladBefore] = [(await rows([f.burger]))[0]!, (await rows([f.salad]))[0]!];
    expect(burgerBefore).toMatchObject({
      requestedAt: AT,
      firedAt: null,
      passControlled: true,
      state: "queued",
    });

    vi.setSystemTime(new Date(LATER));
    expect(await release(f.venue, f.hot, askOf(hotCard!))).toEqual({
      releasedTicketItemIds: [f.burger],
    });
    expect(await rows([f.burger])).toEqual([{ ...burgerBefore, firedAt: LATER, queuedAt: LATER }]);
    expect((await rows([f.burger]))[0]).toMatchObject({
      requestedAt: AT,
      passControlled: true,
      state: "queued",
    });
    expect(await rows([f.salad])).toEqual([saladBefore]);

    expect(await release(f.venue, f.coldPass, askOf(coldCard!))).toEqual({
      releasedTicketItemIds: [f.salad],
    });
    expect(await rows([f.salad])).toEqual([{ ...saladBefore, firedAt: LATER, queuedAt: LATER }]);
  });

  it("refuses a forged mixed batch whole", async () => {
    const f = await hotAndCold();
    const [hotCard] = await toFire(f.venue, f.hot);
    await refusedWhole(
      release(f.venue, f.hot, { ...askOf(hotCard!), ticketItemIds: [f.burger, f.salad] }),
      "ticket.pass_context_changed",
      [f.burger, f.salad],
    );
  });

  it("refuses a pass on the wrong station, and a pass on the right station in another zone", async () => {
    const f = await hotAndCold();
    const [hotCard] = await toFire(f.venue, f.hot);
    const fryer = await passOn(f.venue, "Fryer pass", [f.venue.stations.fryer]);
    const elsewhere = await passOn(
      f.venue,
      "Counter grill pass",
      [f.venue.stations.grill],
      [f.venue.counter.zoneId],
    );
    for (const by of [fryer, elsewhere])
      await refusedWhole(release(f.venue, by, askOf(hotCard!)), "ticket.pass_context_changed", [
        f.burger,
        f.salad,
      ]);
  });

  it("refuses a pass with no zone left, and a dish in no zone to a zone-limited pass", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    const placed = await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      const group = (
        await placeGroups(tx, venue.cfg, venue.party.partyId, {
          operatorId: OPERATOR,
          groups: [{ lines: [dish(venue, "burger")], release: "fire" }],
        })
      ).groups[0]!;
      const counterId = await fireNewOrder(tx, venue.cfg, [
        { productId: venue.products.burger, quantity: "1" },
      ]);
      await tx.execute(
        sql`delete from order_service_contexts where working_order_id = ${counterId}`,
      );
      const [counterItem] = await tx
        .select({ id: ticketItems.id })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, counterId));
      return {
        tabBurger: await ticketItemOf(tx, group.lineIds[0]!),
        counterId,
        counterBurger: counterItem!.id,
      };
    });
    const every = await passOn(venue, "Every pass", null);
    const tablesOnly = await passOn(venue, "Tables pass", null, [venue.party.zoneId]);
    const counterOnly = await passOn(venue, "Counter pass", null, [venue.counter.zoneId]);
    const monitor = await device(venue, "Monitor", {
      kitchenScreen: { kind: "pass_monitor", stationIds: null, zoneIds: null },
    });
    const station = await device(venue, "Grill screen", { stationId: venue.stations.grill });
    const cards = await toFire(venue, every);
    const tabCard = cards.find((card) => card.target.kind === "group")!;
    const counterCard = cards.find((card) => card.target.kind === "bill")!;
    expect(counterCard.target).toEqual({ kind: "bill", workingOrderId: placed.counterId });

    await withTransaction(db, (tx) =>
      tx.update(floorZones).set({ active: false }).where(eq(floorZones.id, venue.party.zoneId)),
    );
    await refusedWhole(release(venue, tablesOnly, askOf(tabCard)), "ticket.pass_context_changed", [
      placed.tabBurger,
    ]);
    await refusedWhole(
      release(venue, counterOnly, askOf(counterCard)),
      "ticket.pass_context_changed",
      [placed.counterBurger],
    );
    for (const by of [monitor, station])
      await refusedWhole(release(venue, by, askOf(counterCard)), "device.unauthorized", [
        placed.counterBurger,
      ]);

    vi.setSystemTime(new Date(LATER));
    const [before] = await rows([placed.counterBurger]);
    expect(await release(venue, every, askOf(counterCard))).toEqual({
      releasedTicketItemIds: [placed.counterBurger],
    });
    expect(await rows([placed.counterBurger])).toEqual([
      { ...before, firedAt: LATER, queuedAt: LATER },
    ]);
  });

  it("refuses a malformed ask by its field", () => {
    const good = {
      submissionId: randomUUID(),
      target: { kind: "group", partyId: randomUUID(), groupId: randomUUID() },
      ticketItemIds: [randomUUID()],
      expectedContext: "a".repeat(64),
    };
    expect(passReleaseAsk(good)).toEqual(good);
    const id = randomUUID();
    for (const [body, field] of [
      [{ ...good, ticketItemIds: [] }, "ticketItemIds"],
      [{ ...good, ticketItemIds: [id, id] }, "ticketItemIds"],
      [{ ...good, ticketItemIds: ["x"] }, "ticketItemIds"],
      [{ ...good, target: { kind: "counter", orderId: randomUUID() } }, "target"],
      [{ ...good, expectedContext: "a".repeat(63) }, "expectedContext"],
    ] as const)
      expect(thrown(() => passReleaseAsk(body))).toMatchObject({
        code: "management.request_invalid",
        params: { field },
      });
  });

  it("refuses an ask naming anything but exactly the card's candidates", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(AT) });
    const venue = await setupSplitExtrasVenue();
    const placed = await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill, venue.stations.fryer]);
      const groups = (
        await placeGroups(tx, venue.cfg, venue.party.partyId, {
          operatorId: OPERATOR,
          groups: [
            { lines: [dish(venue, "burger", true)], release: "fire" },
            { lines: [dish(venue, "burger")], release: "fire" },
            { lines: [dish(venue, "burger")], release: "hold" },
            { lines: [dish(venue, "burger")], release: "fire" },
            { lines: [dish(venue, "burger")], release: "hold" },
          ],
        })
      ).groups;
      const itemsOf = async (groupId: string) =>
        (
          await tx
            .select({ id: ticketItems.id, parentLineId: workingOrderLines.parentLineId })
            .from(ticketItems)
            .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
            .where(eq(workingOrderLines.groupId, groupId))
        ).sort((a, b) => Number(a.parentLineId !== null) - Number(b.parentLineId !== null));
      const [main, other, held, served, deleted] = groups as [
        (typeof groups)[0],
        (typeof groups)[0],
        (typeof groups)[0],
        (typeof groups)[0],
        (typeof groups)[0],
      ];
      const [burger, chips] = await itemsOf(main.id);
      const [party] = await tx
        .select({ revision: parties.revision })
        .from(parties)
        .where(eq(parties.id, venue.party.partyId));
      await markServed(
        tx,
        venue.cfg,
        venue.party.partyId,
        [{ lineId: served.lineIds[0]!, quantity: "1" }],
        {
          operatorId: OPERATOR,
          submissionId: randomUUID(),
          expectedPartyRevision: party!.revision,
        },
      );
      const deletedItem = (await itemsOf(deleted.id))[0]!.id;
      await tx.delete(ticketItems).where(eq(ticketItems.id, deletedItem));
      return {
        mainGroup: main.id,
        burger: burger!.id,
        chips: chips!.id,
        other: (await itemsOf(other.id))[0]!.id,
        held: (await itemsOf(held.id))[0]!.id,
        served: (await itemsOf(served.id))[0]!.id,
        deleted: deletedItem,
      };
    });
    const every = await passOn(venue, "Every pass", null);
    const card = (await toFire(venue, every)).find(
      (entry) => entry.target.kind === "group" && entry.target.groupId === placed.mainGroup,
    )!;
    expect([...card.releaseTicketItemIds].sort()).toEqual([placed.burger, placed.chips].sort());
    const ask = askOf(card);
    const watched = [placed.burger, placed.chips, placed.other, placed.held, placed.served];
    for (const extra of [randomUUID(), placed.deleted, placed.served, placed.held, placed.other])
      await refusedWhole(
        release(venue, every, { ...ask, ticketItemIds: [...ask.ticketItemIds, extra] }),
        "ticket.pass_context_changed",
        watched,
      );
    await refusedWhole(
      release(venue, every, { ...ask, ticketItemIds: [placed.burger] }),
      "ticket.pass_context_changed",
      watched,
    );
  });

  it("neither sweeps a released dish nor offers it again", async () => {
    const f = await hotAndCold();
    const [hotCard] = await toFire(f.venue, f.hot);
    const ask = askOf(hotCard!);
    vi.setSystemTime(new Date(LATER));
    await release(f.venue, f.hot, ask);
    const released = await rows([f.burger]);
    expect(released).toEqual([expect.objectContaining({ firedAt: LATER, queuedAt: LATER })]);

    const fresh = await withTransaction(db, async (tx) => {
      const screen = (
        await VENUE_SERVICE.readDeviceKitchenScreens(tx, f.venue.cfg, f.hot.deviceId)
      ).find((candidate) => candidate.kind === "pass")!;
      return passCardRelease(
        hotCard!.target,
        await readPassCardRows(tx, f.venue.cfg, hotCard!.target),
        passScopeOf(screen),
      );
    });
    expect(fresh).toEqual({ ticketItemIds: [], context: null });

    await refusedWhole(release(f.venue, f.hot, ask), "ticket.pass_context_changed", [f.burger]);
    expect(await rows([f.burger])).toEqual(released);

    await withTransaction(db, (tx) =>
      fireOrderLines(
        tx,
        f.venue.cfg,
        f.venue.party.tabId,
        [f.burgerLine],
        undefined,
        routingOnce(tx, f.venue.cfg, new Date("2026-03-14T12:10:00.000Z")),
      ),
    );
    expect(await rows([f.burger])).toEqual(released);
  });
});
