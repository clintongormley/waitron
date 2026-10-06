import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  deviceProfiles,
  devices,
  ticketItems,
  watcherItemMarks,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { createPinThrottle } from "@waitron/identity";
import { createStation } from "./kitchen.js";
import { VENUE_SERVICE } from "./modules.js";
import { bumpGroupReady, markGroupAway, placeGroups } from "./order-groups.js";
import { createZone } from "./tables.js";
import { routeProductTo, offerProducts } from "./testing/zone-offers.js";
import {
  fireNewOrder,
  setupSplitExtrasVenue,
  useSplitExtrasDb,
} from "./testing/split-extras-venue.js";
import {
  commandFor,
  inTx,
  OPERATOR,
  orderForParty,
  pay,
  placeByHand,
  seat,
  setupPartyVenue,
} from "./testing/party-venue.js";
import { moveGuests } from "./table-actions.js";
import { serveLine } from "./testing/serve-line.js";
import { overridePinAttempts } from "./till-api.js";
import { createWatcher, removeWatcher } from "./watchers.js";
import { listWatcherQueue, markWatcherItems } from "./watcher-board.js";
import {
  addTabRound,
  cancelPlacedOrder,
  carveOffLines,
  createOpenOrder,
  fireableLineColumns,
  fireLines,
  listExpoQueue,
  listStationQueue,
  listTablesWithState,
  markCollected,
  markServed,
  updateOrderLine,
} from "./working-order.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

describe("watcher board", () => {
  it("shows only followed stations and zones, and Done belongs to one watcher", async () => {
    const v = await setupPartyVenue(suite.db);
    const { grill, terrace, pass, runner } = await inTx(v, async (tx) => {
      const grill = (
        await createStation(tx, v.cfg, {
          name: "Grill",
          thresholds: { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 },
        })
      ).id;
      const bar = (
        await createStation(tx, v.cfg, {
          name: "Bar",
          thresholds: { warmAfterMinutes: 2, overdueAfterMinutes: 4, forgottenAfterMinutes: 8 },
        })
      ).id;
      await routeProductTo(tx, v.cfg, v.productId("Burger"), grill);
      await routeProductTo(tx, v.cfg, v.productId("Caña"), bar);
      const terrace = (await createZone(tx, v.cfg, { name: "Terrace" })).id;
      await offerProducts(tx, v.cfg, { zone: { zoneId: terrace }, serviceMode: "table_tab" });
      const pass = (
        await createWatcher(tx, v.cfg, {
          name: "Pass",
          everyStation: false,
          stationIds: [grill],
          everyZone: true,
          zoneIds: [],
          runsPass: true,
        })
      ).id;
      const runner = (
        await createWatcher(tx, v.cfg, {
          name: "Terrace runner",
          everyStation: true,
          stationIds: [],
          everyZone: false,
          zoneIds: [terrace],
          runsPass: false,
        })
      ).id;
      return { grill, terrace, pass, runner };
    });
    const outsideTable = await v.table("Outside", terrace);
    const outside = await seat(v, outsideTable);
    const inside = await seat(v, await v.table("Inside"));
    await orderForParty(v, outside.partyId, ["Burger", "Caña"], outside.tabId);
    await orderForParty(v, inside.partyId, ["Burger"], inside.tabId);
    const read = (id: string) => inTx(v, (tx) => listWatcherQueue(tx, v.cfg, id));
    const passBefore = await read(pass);
    const runnerBefore = await read(runner);
    expect(passBefore.orders.map((o) => o.orderId).sort()).toEqual(
      [outside.tabId, inside.tabId].sort(),
    );
    expect(
      passBefore.orders.flatMap((o) => o.groups.flatMap((g) => g.items.map((i) => i.name))),
    ).toEqual(["BURG", "BURG"]);
    expect(runnerBefore.orders.map((o) => o.orderId)).toEqual([outside.tabId]);
    expect(runnerBefore.orders[0]!.groups.flatMap((g) => g.items.map((i) => i.name))).toEqual([
      "BURG",
      "CANA",
    ]);
    expect(passBefore.orders.find((o) => o.orderId === outside.tabId)!.groups[0]).toMatchObject({
      allReady: false,
      items: [{ name: "BURG" }],
    });
    const lagerId = runnerBefore.orders[0]!.groups[0]!.items.find(
      (item) => item.name === "CANA",
    )!.id;
    await inTx(v, (tx) =>
      tx.update(ticketItems).set({ state: "ready" }).where(eq(ticketItems.id, lagerId)),
    );
    await inTx(v, (tx) =>
      tx
        .update(ticketItems)
        .set({ state: "ready" })
        .where(
          eq(
            ticketItems.id,
            runnerBefore.orders[0]!.groups[0]!.items.find((item) => item.name === "BURG")!.id,
          ),
        ),
    );
    expect(
      (await read(pass)).orders.find((o) => o.orderId === outside.tabId)!.groups[0],
    ).toMatchObject({ allReady: true, items: [{ name: "BURG" }] });
    expect(
      runnerBefore.orders[0]!.groups.flatMap((g) =>
        g.items.map((i) => [i.stationName, i.thresholds]),
      ),
    ).toEqual([
      ["Grill", { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 }],
      ["Bar", { warmAfterMinutes: 2, overdueAfterMinutes: 4, forgottenAfterMinutes: 8 }],
    ]);
    const [burger] = await inTx(v, (tx) =>
      tx
        .select()
        .from(ticketItems)
        .where(
          and(eq(ticketItems.workingOrderId, outside.tabId), eq(ticketItems.stationId, grill)),
        ),
    );
    const beforeRecord = burger!;
    const beforeStation = await inTx(v, (tx) => listStationQueue(tx, grill));
    const beforePass = await inTx(v, (tx) => listExpoQueue(tx, v.cfg));
    const beforeFloor = (await inTx(v, (tx) => listTablesWithState(tx, v.cfg))).find(
      (row) => row.id === outsideTable,
    )!;
    const [deviceOne, deviceTwo] = await inTx(v, async (tx) => {
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({ name: `Watcher ${randomUUID()}`, formFactor: "kds" })
        .returning({ id: deviceProfiles.id });
      return tx
        .insert(devices)
        .values(
          [1, 2].map((n) => ({
            locationId: v.cfg.locationId,
            watcherId: pass,
            deviceProfileId: profile!.id,
            label: `Pass screen ${n}`,
            tokenHash: randomUUID(),
          })),
        )
        .returning({ id: devices.id });
    });
    const first = new Date("2026-10-01T12:00:00.000Z");
    await inTx(v, (tx) =>
      markWatcherItems(tx, v.cfg, pass, [burger!.id], true, { deviceId: deviceOne!.id }, first),
    );
    await inTx(v, (tx) =>
      markWatcherItems(
        tx,
        v.cfg,
        pass,
        [burger!.id],
        true,
        { deviceId: deviceTwo!.id },
        new Date("2026-10-01T13:00:00.000Z"),
      ),
    );
    expect((await read(pass)).orders.map((o) => o.orderId)).toEqual([inside.tabId]);
    expect(
      (await read(runner)).orders[0]!.groups.flatMap((g) => g.items.map((i) => i.name)),
    ).toEqual(["BURG", "CANA"]);
    expect(
      await inTx(v, (tx) =>
        tx.select().from(watcherItemMarks).where(eq(watcherItemMarks.ticketItemId, burger!.id)),
      ),
    ).toMatchObject([
      {
        watcherId: pass,
        ticketItemId: burger!.id,
        doneAt: first.toISOString(),
        doneByDeviceId: deviceOne!.id,
        doneByPersonId: null,
      },
    ]);
    expect(
      await inTx(v, (tx) => tx.select().from(ticketItems).where(eq(ticketItems.id, burger!.id))),
    ).toEqual([beforeRecord]);
    expect(await inTx(v, (tx) => listStationQueue(tx, grill))).toEqual(beforeStation);
    expect(await inTx(v, (tx) => listExpoQueue(tx, v.cfg))).toEqual(beforePass);
    expect(
      (await inTx(v, (tx) => listTablesWithState(tx, v.cfg))).find(
        (row) => row.id === outsideTable,
      ),
    ).toEqual(beforeFloor);
    await inTx(v, (tx) =>
      markWatcherItems(tx, v.cfg, pass, [burger!.id], false, { personId: randomUUID() }, first),
    );
    expect(
      (await read(pass)).orders
        .find((o) => o.orderId === outside.tabId)!
        .groups.flatMap((g) => g.items.map((i) => i.name)),
    ).toEqual(["BURG"]);
    await inTx(v, async (tx) => {
      const cold = (await createStation(tx, v.cfg, { name: "Cold" })).id;
      await routeProductTo(tx, v.cfg, v.productId("Flan"), cold);
    });
    await orderForParty(v, outside.partyId, ["Flan"], outside.tabId);
    expect(
      (await read(runner)).orders
        .find((o) => o.orderId === outside.tabId)!
        .groups.flatMap((g) => g.items.map((i) => i.name)),
    ).toContain("FLAN");
    expect(
      (await read(pass)).orders
        .find((o) => o.orderId === outside.tabId)!
        .groups.flatMap((g) => g.items.map((i) => i.name)),
    ).not.toContain("FLAN");
    const movedInside = await v.table("Moved inside");
    const move = await commandFor(v, outside.partyId);
    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, outside.partyId, movedInside, {
        ...move,
        bills: "separate",
        otherPartyId: null,
      }),
    );
    expect((await read(runner)).orders).toEqual([]);
    expect((await read(pass)).orders.map((o) => o.orderId).sort()).toEqual(
      [outside.tabId, inside.tabId].sort(),
    );
    const presentedParty = await seat(v, await v.table("Presented outside", terrace));
    await orderForParty(v, presentedParty.partyId, ["Burger"], presentedParty.tabId);
    await placeByHand(v, presentedParty.tabId);
    expect((await read(runner)).orders.map((o) => o.orderId)).toEqual([presentedParty.tabId]);
    const presentedInside = await v.table("Presented inside");
    const presentedMove = await commandFor(v, presentedParty.partyId);
    await inTx(v, (tx) =>
      moveGuests(tx, v.cfg, presentedParty.partyId, presentedInside, {
        ...presentedMove,
        bills: "separate",
        otherPartyId: null,
      }),
    );
    expect(
      await inTx(v, (tx) => VENUE_SERVICE.findOrderZones(tx, v.cfg, [presentedParty.tabId])),
    ).toEqual(new Map([[presentedParty.tabId, terrace]]));
    expect((await read(runner)).orders).toEqual([]);
  });

  it("keeps sent-out work until Done or service, without ageing the sent-out order", async () => {
    const v = await setupPartyVenue(suite.db);
    const watcherId = await inTx(
      v,
      async (tx) =>
        (
          await createWatcher(tx, v.cfg, {
            name: "Runner",
            everyStation: true,
            stationIds: [],
            everyZone: true,
            zoneIds: [],
            runsPass: false,
          })
        ).id,
    );
    const party = await seat(v, await v.table("Away table"));
    await orderForParty(v, party.partyId, ["Burger", "Caña"], party.tabId);
    const items = await inTx(v, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, party.tabId)),
    );
    expect(items).toHaveLength(2);
    const read = () => inTx(v, (tx) => listWatcherQueue(tx, v.cfg, watcherId));
    await inTx(v, (tx) =>
      tx.update(ticketItems).set({ madeHere: true }).where(eq(ticketItems.id, items[1]!.id)),
    );
    expect((await read()).orders[0]!.groups[0]!.items.map((item) => item.id)).toEqual([
      items[0]!.id,
    ]);
    await inTx(v, (tx) =>
      tx.update(ticketItems).set({ madeHere: false }).where(eq(ticketItems.id, items[1]!.id)),
    );
    expect((await read()).orders[0]!.groups[0]!.allReady).toBe(false);
    const [line] = await inTx(v, (tx) =>
      tx
        .select({ groupId: workingOrderLines.groupId })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.id, items[0]!.workingOrderLineId)),
    );
    const ready = await commandFor(v, party.partyId);
    await inTx(v, (tx) =>
      bumpGroupReady(tx, v.cfg, party.partyId, line!.groupId!, {
        ...ready,
        submissionId: randomUUID(),
      }),
    );
    const away = await commandFor(v, party.partyId);
    await inTx(v, (tx) =>
      markGroupAway(tx, v.cfg, party.partyId, line!.groupId!, {
        ...away,
        submissionId: randomUUID(),
      }),
    );
    const old = new Date(Date.now() - 90 * 60_000).toISOString();
    await inTx(v, (tx) =>
      tx
        .update(ticketItems)
        .set({ queuedAt: old })
        .where(eq(ticketItems.workingOrderId, party.tabId)),
    );
    const sent = (await read()).orders[0]!;
    expect(sent.groups[0]).toMatchObject({ away: true, allReady: true });
    expect(sent.groups[0]!.items.every((item) => item.awayAt !== null)).toBe(true);
    expect(sent.groups[0]!.items.map((item) => item.band)).toEqual(["forgotten", "forgotten"]);
    expect(sent.worstBand).toBe("fresh");
    await inTx(v, (tx) =>
      markWatcherItems(
        tx,
        v.cfg,
        watcherId,
        items.map((item) => item.id),
        true,
        { personId: randomUUID() },
        new Date(),
      ),
    );
    expect((await read()).orders).toEqual([]);
    await inTx(v, (tx) =>
      markWatcherItems(
        tx,
        v.cfg,
        watcherId,
        items.map((item) => item.id),
        false,
        { personId: randomUUID() },
        new Date(),
      ),
    );
    expect((await read()).orders).toHaveLength(1);
    await inTx(v, (tx) => serveLine(tx, v.cfg, party.tabId, 1));
    expect((await read()).orders[0]!.groups[0]!.items).toHaveLength(1);
    await inTx(v, (tx) => serveLine(tx, v.cfg, party.tabId, 2));
    expect((await read()).orders).toEqual([]);
  });

  it("keeps a partially served dish until serveLine serves its remainder", async () => {
    const v = await setupPartyVenue(suite.db);
    const watcherId = await inTx(
      v,
      async (tx) =>
        (
          await createWatcher(tx, v.cfg, {
            name: "Pass",
            everyStation: true,
            stationIds: [],
            everyZone: true,
            zoneIds: [],
            runsPass: false,
          })
        ).id,
    );
    const party = await seat(v, await v.table("Partial service"));
    await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, party.partyId, {
        billId: party.tabId,
        groups: [{ lines: [{ menuItemId: v.item("Burger"), quantity: "2" }], release: "fire" }],
        operatorId: OPERATOR,
      }),
    );
    const [line] = await inTx(v, (tx) =>
      tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, party.tabId)),
    );
    const command = await commandFor(v, party.partyId);
    await inTx(v, (tx) =>
      markServed(tx, v.cfg, party.partyId, [{ lineId: line!.id, quantity: "1" }], {
        ...command,
        submissionId: randomUUID(),
      }),
    );
    const read = () => inTx(v, (tx) => listWatcherQueue(tx, v.cfg, watcherId));
    expect((await read()).orders[0]!.groups[0]!.items).toHaveLength(1);
    await inTx(v, (tx) => serveLine(tx, v.cfg, party.tabId, 1));
    expect((await read()).orders).toEqual([]);
  });

  it("drops handed-over and discarded orders, and refuses an inactive or unknown watcher", async () => {
    const v = await setupPartyVenue(suite.db);
    const watcherId = await inTx(
      v,
      async (tx) =>
        (
          await createWatcher(tx, v.cfg, {
            name: "Pass",
            everyStation: true,
            stationIds: [],
            everyZone: true,
            zoneIds: [],
            runsPass: true,
          })
        ).id,
    );
    const party = await seat(v, await v.table("Leaving table"));
    await orderForParty(v, party.partyId, ["Burger"], party.tabId);
    const read = () => inTx(v, (tx) => listWatcherQueue(tx, v.cfg, watcherId));
    expect((await read()).orders).toHaveLength(1);
    await pay(v, party.tabId, "12.00");
    expect((await read()).orders).toHaveLength(1);
    await markCollected({ db: v.db }, v.cfg, party.tabId);
    expect((await read()).orders).toEqual([]);
    const heldParty = await seat(v, await v.table("Held table"));
    await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, heldParty.partyId, {
        billId: heldParty.tabId,
        groups: [{ lines: [{ menuItemId: v.item("Burger"), quantity: "1" }], release: "hold" }],
        operatorId: OPERATOR,
      }),
    );
    expect((await read()).orders[0]!.groups[0]!.items[0]!.firedAt).toBeNull();
    await placeByHand(v, heldParty.tabId);
    await cancelPlacedOrder(
      { db: v.db, backend: v.backend, clock: v.clock },
      v.cfg,
      heldParty.tabId,
      "Guests left",
      {
        personId: OPERATOR,
        sessionId: "unused",
        attempts: overridePinAttempts(createPinThrottle(), "unused"),
      },
    );
    expect((await read()).orders).toEqual([]);
    const [heldItem] = await inTx(v, (tx) =>
      tx
        .select({ id: ticketItems.id })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, heldParty.tabId)),
    );
    await expect(
      inTx(v, (tx) =>
        markWatcherItems(
          tx,
          v.cfg,
          randomUUID(),
          [heldItem!.id],
          true,
          { personId: OPERATOR },
          new Date(),
        ),
      ),
    ).rejects.toMatchObject({ code: "watcher.not_found" });
    const missingItem = randomUUID();
    await inTx(v, (tx) =>
      markWatcherItems(
        tx,
        v.cfg,
        watcherId,
        [missingItem],
        true,
        { personId: OPERATOR },
        new Date(),
      ),
    );
    await inTx(v, (tx) =>
      markWatcherItems(tx, v.cfg, watcherId, [], true, { personId: OPERATOR }, new Date()),
    );
    expect(
      await inTx(v, (tx) =>
        tx.select().from(watcherItemMarks).where(eq(watcherItemMarks.watcherId, watcherId)),
      ),
    ).toEqual([]);
    // A device still naming the watcher keeps it, disabled, rather than deleted.
    await inTx(v, async (tx) => {
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({ name: `Watcher ${randomUUID()}`, formFactor: "kds" })
        .returning({ id: deviceProfiles.id });
      await tx.insert(devices).values({
        locationId: v.cfg.locationId,
        watcherId,
        deviceProfileId: profile!.id,
        label: "Pass screen",
        tokenHash: randomUUID(),
      });
    });
    await inTx(v, (tx) => removeWatcher(tx, v.cfg, watcherId));
    expect(await read()).toEqual({
      watcher: { id: watcherId, name: "Pass", runsPass: true, active: false },
      orders: [],
    });
    await expect(
      inTx(v, (tx) =>
        markWatcherItems(tx, v.cfg, watcherId, [], true, { personId: randomUUID() }, new Date()),
      ),
    ).rejects.toMatchObject({ code: "watcher.not_found" });
    await expect(inTx(v, (tx) => listWatcherQueue(tx, v.cfg, randomUUID()))).rejects.toMatchObject({
      code: "watcher.not_found",
    });
  });

  it("keeps a Done mark on a ticket item copied by a quantity split", async () => {
    const v = await setupPartyVenue(suite.db);
    const watcherId = await inTx(
      v,
      async (tx) =>
        (
          await createWatcher(tx, v.cfg, {
            name: "Pass",
            everyStation: true,
            stationIds: [],
            everyZone: true,
            zoneIds: [],
            runsPass: false,
          })
        ).id,
    );
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
      await markWatcherItems(
        tx,
        v.cfg,
        watcherId,
        [item!.id],
        true,
        { personId: randomUUID() },
        new Date(),
      );
      await carveOffLines(tx, v.cfg, party.tabId, party.tabId, [{ lineNo: 1, quantity: "1" }], {
        refuseHeld: false,
      });
    });
    const marks = await inTx(v, (tx) =>
      tx.select().from(watcherItemMarks).where(eq(watcherItemMarks.watcherId, watcherId)),
    );
    expect(marks).toHaveLength(2);
    expect(new Set(marks.map((mark) => mark.ticketItemId))).toEqual(
      new Set(
        (
          await inTx(v, (tx) =>
            tx
              .select({ id: ticketItems.id })
              .from(ticketItems)
              .where(eq(ticketItems.workingOrderId, party.tabId)),
          )
        ).map((row) => row.id),
      ),
    );
    expect((await inTx(v, (tx) => listWatcherQueue(tx, v.cfg, watcherId))).orders).toEqual([]);
  });

  it("shows a changed dish again when an edit replaces its marked kitchen record", async () => {
    const v = await setupPartyVenue(suite.db);
    const watcherId = await inTx(
      v,
      async (tx) =>
        (
          await createWatcher(tx, v.cfg, {
            name: "Pass",
            everyStation: true,
            stationIds: [],
            everyZone: true,
            zoneIds: [],
            runsPass: false,
          })
        ).id,
    );
    const party = await seat(v, await v.table("Edited table"));
    await inTx(v, (tx) =>
      addTabRound(tx, v.cfg, party.tabId, [{ menuItemId: v.item("Burger"), quantity: "1" }]),
    );
    const [old] = await inTx(v, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, party.tabId)),
    );
    await inTx(v, (tx) =>
      markWatcherItems(tx, v.cfg, watcherId, [old!.id], true, { personId: OPERATOR }, new Date()),
    );
    expect((await inTx(v, (tx) => listWatcherQueue(tx, v.cfg, watcherId))).orders).toEqual([]);
    const [bill] = await inTx(v, (tx) =>
      tx
        .select({ revision: workingOrders.revision })
        .from(workingOrders)
        .where(eq(workingOrders.id, party.tabId)),
    );
    await inTx(v, (tx) =>
      updateOrderLine(tx, v.cfg, party.tabId, 1, { note: "No salt" }, bill!.revision, OPERATOR),
    );
    const [changed] = await inTx(v, (tx) =>
      tx.select().from(ticketItems).where(eq(ticketItems.workingOrderId, party.tabId)),
    );
    expect(changed!.id).not.toBe(old!.id);
    expect(
      await inTx(v, (tx) =>
        tx.select().from(watcherItemMarks).where(eq(watcherItemMarks.watcherId, watcherId)),
      ),
    ).toEqual([]);
    expect(
      (await inTx(v, (tx) => listWatcherQueue(tx, v.cfg, watcherId))).orders[0]!.groups[0]!.items,
    ).toMatchObject([{ id: changed!.id, note: "No salt" }]);
  });

  it("shows split extras with their maker and leaves no-preparation parents out", async () => {
    useSplitExtrasDb(suite.db);
    const venue = await setupSplitExtrasVenue();
    await inTx({ db: suite.db }, async (tx) => {
      const watcherId = (
        await createWatcher(tx, venue.cfg, {
          name: "Pass",
          everyStation: false,
          stationIds: [venue.stations.grill, venue.stations.fryer],
          everyZone: true,
          zoneIds: [],
          runsPass: false,
        })
      ).id;
      await fireNewOrder(tx, venue.cfg, [
        {
          productId: venue.products.burger,
          quantity: "1",
          extras: [
            {
              listId: venue.lists.burger,
              picks: [{ productId: venue.products.chips, quantity: 2 }],
            },
          ],
        },
      ]);
      const burgerBoard = await listWatcherQueue(tx, venue.cfg, watcherId);
      const burgerItems = burgerBoard.orders.flatMap((order) =>
        order.courses.flatMap((course) => course.items),
      );
      expect(burgerItems.map((item) => [item.name, item.stationName])).toEqual([
        ["BURG", "Grill"],
        ["CHIPS", "Fryer"],
      ]);
      expect(burgerItems.find((item) => item.name === "CHIPS")!.crossRefs).toEqual([
        { kind: "for", name: "BURG", stationName: "Grill" },
      ]);
      await fireNewOrder(tx, venue.cfg, [
        {
          productId: venue.products.water,
          quantity: "1",
          extras: [
            {
              listId: venue.lists.water,
              picks: [{ productId: venue.products.chips, quantity: 1 }],
            },
          ],
        },
      ]);
      const board = await listWatcherQueue(tx, venue.cfg, watcherId);
      const items = board.orders.flatMap((order) =>
        order.courses.flatMap((course) => course.items),
      );
      expect(items.map((item) => item.name).sort()).toEqual(["BURG", "CHIPS", "CHIPS"]);
      expect(
        items.find((item) => item.crossRefs?.some((ref) => ref.name === "AGUA"))!.crossRefs,
      ).toEqual([{ kind: "for", name: "AGUA", stationName: null }]);

      const terrace = (await createZone(tx, venue.cfg, { name: "Terrace" })).id;
      const terraceOffers = await offerProducts(tx, venue.cfg, {
        zone: { zoneId: terrace },
        serviceMode: "table_tab",
      });
      const runnerId = (
        await createWatcher(tx, venue.cfg, {
          name: "Terrace runner",
          everyStation: true,
          stationIds: [],
          everyZone: false,
          zoneIds: [terrace],
          runsPass: false,
        })
      ).id;
      const terraceOrderId = randomUUID();
      await createOpenOrder(
        tx,
        venue.cfg,
        terraceOrderId,
        terraceOffers.toOfferLines([
          {
            productId: venue.products.burger,
            quantity: "1",
            extras: [
              {
                listId: venue.lists.burger,
                picks: [{ productId: venue.products.chips, quantity: 1 }],
              },
            ],
          },
        ]),
        null,
        { zoneId: terrace },
      );
      const terraceLines = await tx
        .select(fireableLineColumns)
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, terraceOrderId))
        .orderBy(workingOrderLines.lineNo);
      await fireLines(tx, venue.cfg, terraceOrderId, terraceLines);
      const runner = await listWatcherQueue(tx, venue.cfg, runnerId);
      expect(runner.orders.map((order) => order.orderId)).toEqual([terraceOrderId]);
      const runnerItems = runner.orders[0]!.courses.flatMap((course) => course.items);
      expect(runnerItems.map((item) => [item.name, item.stationName])).toEqual([
        ["BURG", "Grill"],
        ["CHIPS", "Fryer"],
      ]);
      expect(runnerItems.find((item) => item.name === "CHIPS")!.crossRefs).toEqual([
        { kind: "for", name: "BURG", stationName: "Grill" },
      ]);
    });
  });
});
