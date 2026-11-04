import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  deviceProfiles,
  kitchenStations,
  parties,
  ticketItems,
  withTransaction,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { writePartyAllergy } from "@waitron/venue-service";
import { setupSplitExtrasVenue, useSplitExtrasDb } from "./testing/split-extras-venue.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import {
  inTx,
  OPERATOR,
  pay,
  seatWithNoAllergies,
  setupPartyVenue,
} from "./testing/party-venue.js";
import { combineParties } from "./testing/table-action-fixture.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { readScopedPassBoard, type PassScope } from "./pass-board.js";
import type { PassBoard, PassCard } from "./pass-card.js";
import { fireGroup } from "./order-groups.js";
import { releasePassItems, type PassActor } from "./pass-release.js";
import { createTable } from "./testing/live-table.js";
import { seatTable } from "./parties.js";
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

const at = (hhmm: string) => new Date(`2026-03-14T${hhmm}:00.000Z`);
const EVERY: PassScope = { stationIds: null, zoneIds: null };

type Venue = Awaited<ReturnType<typeof setupSplitExtrasVenue>>;

const burger = (venue: Venue) => ({
  menuItemId: venue.tables.offerFor(venue.products.burger),
  quantity: "1",
});

async function ticketItemOf(tx: Transaction, lineId: string): Promise<string> {
  const [row] = await tx
    .select({ id: ticketItems.id })
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderLineId, lineId));
  return row!.id;
}

async function partyRow(tx: Transaction, partyId: string) {
  const [row] = await tx
    .select({ id: parties.id, revision: parties.revision })
    .from(parties)
    .where(eq(parties.id, partyId));
  return row!;
}

const cards = (board: PassBoard): PassCard[] => [
  ...board.held,
  ...board.toFire,
  ...board.inProgress,
  ...board.ready,
];

let current: Venue;
const board = () => withTransaction(db, (tx) => readScopedPassBoard(tx, EVERY));

const bandAt = async (when: Date, itemId: string) => {
  vi.setSystemTime(when);
  const item = cards(await board())
    .flatMap((card) => card.items)
    .find((candidate) => candidate.id === itemId);
  expect(item).toBeDefined();
  return item!.band;
};

/** Grill waits; a burger held at 12:00, its group fired at 12:30. */
async function heldThenFired(venue: Venue) {
  return withTransaction(db, async (tx) => {
    await setStationsWaitForPass(tx, true, [venue.stations.grill]);
    vi.setSystemTime(at("12:00"));
    const placed = await placeGroups(tx, venue.cfg, venue.party.partyId, {
      operatorId: OPERATOR,
      groups: [{ lines: [burger(venue)], release: "hold" }],
    });
    const group = placed.groups[0]!;
    vi.setSystemTime(at("12:30"));
    await fireGroup(tx, venue.cfg, venue.party.partyId, group.id, {
      submissionId: randomUUID(),
      expectedPartyRevision: (await partyRow(tx, venue.party.partyId)).revision,
      operatorId: OPERATOR,
    });
    return { groupId: group.id, burgerItem: await ticketItemOf(tx, group.lineIds[0]!) };
  });
}

async function passDevice(venue: Venue): Promise<PassActor> {
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
  const joined = await enrolDeviceForTest(db, venue.cfg, {
    name: "Pass",
    profileId: profile!.id,
    kitchenScreen: { kind: "pass", stationIds: null, zoneIds: null },
  });
  return { deviceId: joined.deviceId, personId: null };
}

async function seatAnotherParty(tx: Transaction, venue: Venue, label: string): Promise<string> {
  const { id: tableId } = await createTable(tx, venue.cfg, { label, zoneId: venue.party.zoneId });
  const { partyId } = await seatTable(tx, venue.cfg, {
    tableId,
    guestCount: null,
    operatorId: OPERATOR,
  });
  await writePartyAllergy(tx, partyId, { answer: "none", guests: [] }, OPERATOR);
  return partyId;
}

const groupCard = (pass: PassBoard, groupId: string) => {
  const found = cards(pass).filter(
    (card) => card.target.kind === "group" && card.target.groupId === groupId,
  );
  expect(found).toHaveLength(1);
  return found[0]!;
};

describe("A773 pass board: ages and party", () => {
  it("ages a Requested dish from its request, not from when it was held", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: at("12:00") });
    current = await setupSplitExtrasVenue();
    const { burgerItem } = await heldThenFired(current);
    expect(await bandAt(at("12:31"), burgerItem)).toBe("fresh");
    expect(await bandAt(at("12:46"), burgerItem)).toBe("forgotten");
  });

  it("ages a dish the pass released from the release", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: at("12:00") });
    current = await setupSplitExtrasVenue();
    const { groupId, burgerItem } = await heldThenFired(current);
    const by = await passDevice(current);
    vi.setSystemTime(at("12:40"));
    const card = groupCard(await board(), groupId);
    await withTransaction(db, (tx) =>
      releasePassItems(tx, current.cfg, by, {
        submissionId: randomUUID(),
        target: card.target,
        ticketItemIds: card.releaseTicketItemIds,
        expectedContext: card.releaseContext,
      }),
    );
    const [stored] = await withTransaction(db, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.id, burgerItem)),
    );
    expect(stored).toMatchObject({ firedAt: at("12:40").toISOString() });
    expect(await bandAt(at("12:41"), burgerItem)).toBe("fresh");
  });

  it("ages a dish at a station that does not wait from when it was sent", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: at("12:00") });
    current = await setupSplitExtrasVenue();
    const burgerItem = await withTransaction(db, async (tx) => {
      const placed = await placeGroups(tx, current.cfg, current.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [burger(current)], release: "fire" }],
      });
      return ticketItemOf(tx, placed.groups[0]!.lineIds[0]!);
    });
    expect(await bandAt(at("12:16"), burgerItem)).toBe("forgotten");
  });

  it("gives a group card after a merge its own party, not its first bill's", async () => {
    const v = await setupPartyVenue(db);
    const paid = await seatWithNoAllergies(v, await v.table("Paid first"));
    const placed = await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, paid.partyId, {
        billId: paid.tabId,
        operatorId: OPERATOR,
        groups: [{ lines: [{ menuItemId: v.item("Burger"), quantity: "1" }], release: "fire" }],
      }),
    );
    await pay(v, paid.tabId, "12.00");
    const into = await seatWithNoAllergies(v, await v.table("Merged into"));
    const target = await inTx(v, async (tx) => {
      await combineParties(tx, v.cfg, {
        from: paid.partyId,
        into: into.partyId,
        tables: "join",
        operatorId: OPERATOR,
      });
      const closed = await partyRow(tx, paid.partyId);
      let surviving = await partyRow(tx, into.partyId);
      // Equal revisions could not tell which party's revision the card carries.
      if (closed.revision === surviving.revision) {
        await tx
          .update(parties)
          .set({ revision: sql`${parties.revision} + 3` })
          .where(eq(parties.id, into.partyId));
        surviving = await partyRow(tx, into.partyId);
      }
      expect(surviving.revision).not.toBe(closed.revision);
      return surviving;
    });
    const merged = await inTx(v, (tx) => readScopedPassBoard(tx, EVERY));
    const card = groupCard(merged, placed.groups[0]!.id);
    expect(card.target).toMatchObject({ kind: "group", partyId: target.id });
    expect(card.party).toEqual({ id: target.id, revision: target.revision });
  });

  it("gives a group card on an unmerged party that party's stored revision", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: at("12:00") });
    current = await setupSplitExtrasVenue();
    const { groupId } = await heldThenFired(current);
    const stored = await withTransaction(db, (tx) => partyRow(tx, current.party.partyId));
    const card = groupCard(await board(), groupId);
    expect(card.target).toMatchObject({ kind: "group", partyId: current.party.partyId });
    expect(card.party).toEqual({ id: current.party.partyId, revision: stored.revision });
  });
});

describe("A773 pass board: dimming", () => {
  const burgerWithChips = (venue: Venue) => ({
    ...burger(venue),
    extras: [
      {
        listId: venue.lists.burger,
        picks: [{ productId: venue.products.chips, quantity: 1 }],
      },
    ],
  });

  /** A Fire now group of a burger with chips on `partyId`; the chips split off to Fryer. */
  async function fireBurgerWithChips(tx: Transaction, venue: Venue, partyId: string) {
    const placed = await placeGroups(tx, venue.cfg, partyId, {
      operatorId: OPERATOR,
      groups: [{ lines: [burgerWithChips(venue)], release: "fire" }],
    });
    return placed.groups[0]!.id;
  }

  const items = (pass: PassBoard) => cards(pass).flatMap((card) => card.items);
  const atStation = (pass: PassBoard, stationId: string) => {
    const found = items(pass).filter((item) => item.stationId === stationId);
    expect(found).toHaveLength(1);
    return found[0]!;
  };
  const read = (scope: PassScope) => withTransaction(db, (tx) => readScopedPassBoard(tx, scope));

  it("1. dims nothing at a venue where no station waits, and counts every dish", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: at("12:00") });
    current = await setupSplitExtrasVenue();
    const { grill, fryer } = current.stations;
    await withTransaction(db, (tx) => fireBurgerWithChips(tx, current, current.party.partyId));
    vi.setSystemTime(at("12:25"));
    const calm = await read(EVERY);
    expect(items(calm)).toHaveLength(2);
    for (const item of items(calm))
      expect(item).toMatchObject({ visible: true, informational: false });
    expect(atStation(calm, grill).band).toBe("forgotten");
    expect(atStation(calm, fryer).visible).toBe(true);
    expect(calm.overview).toHaveLength(2);
    for (const fact of calm.overview) expect(fact.informational).toBe(false);

    await withTransaction(db, (tx) => setStationsWaitForPass(tx, true, [current.stations.bar]));
    const barWaits = await read(EVERY);
    expect(items(barWaits).map((item) => item.informational)).toEqual([true, true]);
  });

  it("2. dims nothing when the only waiting station is out of the pass's view", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: at("12:00") });
    current = await setupSplitExtrasVenue();
    const { grill, fryer, bar } = current.stations;
    await withTransaction(db, async (tx) => {
      await fireBurgerWithChips(tx, current, current.party.partyId);
      await setStationsWaitForPass(tx, true, [fryer]);
    });
    const pass = await read({ stationIds: [grill, bar], zoneIds: null });
    expect(atStation(pass, grill).informational).toBe(false);
  });

  it("2b. dims nothing in view when the only pass work is out of the pass's view", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: at("12:00") });
    current = await setupSplitExtrasVenue();
    const { grill, fryer, bar } = current.stations;
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [fryer]);
      await fireBurgerWithChips(tx, current, current.party.partyId);
    });
    const pass = await read({ stationIds: [grill, bar], zoneIds: null });
    expect(atStation(pass, fryer)).toMatchObject({
      phase: "requested",
      passControlled: true,
      visible: false,
      informational: true,
    });
    expect(atStation(pass, grill)).toMatchObject({
      passControlled: false,
      visible: true,
      informational: false,
    });
  });

  it("3. keeps a dish out of the pass's view informational while dimming nothing in view", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: at("12:00") });
    current = await setupSplitExtrasVenue();
    const { grill, fryer } = current.stations;
    await withTransaction(db, (tx) => fireBurgerWithChips(tx, current, current.party.partyId));
    const pass = await read({ stationIds: [grill], zoneIds: null });
    expect(atStation(pass, fryer)).toMatchObject({ visible: false, informational: true });
    expect(atStation(pass, grill)).toMatchObject({ visible: true, informational: false });
  });

  it("4. keeps dimming while the board holds pass work, after its station stops waiting", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: at("12:00") });
    current = await setupSplitExtrasVenue();
    const { grill, fryer } = current.stations;
    const { requestedGroup, releasedGroup } = await withTransaction(db, async (tx) => {
      const other = await seatAnotherParty(tx, current, "Released first");
      const releasedGroup = await fireBurgerWithChips(tx, current, other);
      await setStationsWaitForPass(tx, true, [grill]);
      const placed = await placeGroups(tx, current.cfg, current.party.partyId, {
        operatorId: OPERATOR,
        groups: [{ lines: [burger(current)], release: "fire" }],
      });
      return { requestedGroup: placed.groups[0]!.id, releasedGroup };
    });
    const check = (pass: PassBoard) => {
      const requested = groupCard(pass, requestedGroup).items;
      expect(requested).toHaveLength(1);
      expect(requested[0]).toMatchObject({ phase: "requested", passControlled: true });
      const fryerDish = groupCard(pass, releasedGroup).items.find(
        (item) => item.stationId === fryer,
      );
      expect(fryerDish?.phase).not.toBe("requested");
      expect(fryerDish?.phase).not.toBe("held");
      expect(fryerDish!.passControlled).toBe(false);
      return { requested: requested[0]!, fryerDish: fryerDish! };
    };
    const waiting = check(await read(EVERY));
    expect(waiting.requested.informational).toBe(false);
    expect(waiting.fryerDish.informational).toBe(true);

    await withTransaction(db, (tx) => setStationsWaitForPass(tx, false, [grill]));
    const stopped = check(await read(EVERY));
    expect(stopped.fryerDish.informational).toBe(true);
  });

  it("6. ignores an inactive station left waiting", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: at("12:00") });
    current = await setupSplitExtrasVenue();
    const { grill, fryer, bar } = current.stations;
    await withTransaction(db, async (tx) => {
      await fireBurgerWithChips(tx, current, current.party.partyId);
      await setStationsWaitForPass(tx, true, [bar]);
      await tx.update(kitchenStations).set({ active: false }).where(eq(kitchenStations.id, bar));
    });
    for (const scope of [EVERY, { stationIds: [grill, fryer, bar], zoneIds: null }]) {
      const pass = await read(scope);
      expect(items(pass).map((item) => item.informational)).toEqual([false, false]);
    }
  });
});
