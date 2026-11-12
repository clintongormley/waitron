import { testTradingAdmission } from "./testing/trading-admission.js";
import { updateHeldOrder } from "./testing/order-writer-fixture.js";
import { saveDraftForTest as saveDraft } from "./testing/draft-command-fixture.js";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  devices,
  deviceMadeHereStations,
  kitchenStations,
  stationPrinters,
  printJobs,
  kitchenPrintJobs,
  ticketItemMoves,
  printers,
  workingOrders,
  workingOrderLines,
  ticketItems,
  orderDrafts,
  orderDraftLines,
  orderDraftEvents,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedDeviceProfiles, seedWorkingOrder } from "@waitron/db/testing/seed.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  closeStationForToday,
  setDeviceKitchenScreens,
  setProfileKitchenScreens,
} from "@waitron/venue-service";
import { deleteDevice } from "./device-delete.js";
import { deleteStation, readStationDeleteImpact } from "./station-delete.js";
import { createStation, listStations, updateStation, setDefaultStation } from "./kitchen.js";
import { listStationPrinters } from "./station-printers.js";
import {
  inTx,
  setupPartyVenue,
  seat,
  join,
  OPERATOR,
  type PartyVenue,
} from "./testing/party-venue.js";
import { listStationQueue } from "./working-order.js";
import { openDishCount, withStationDishes } from "./station-closing.js";
import { readRestOfOrder } from "./rest-of-order.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const at = "2026-10-10T12:00:00.000Z";
async function fixture() {
  const v = await setupPartyVenue(suite.db);
  const { id } = await inTx(v, (tx) => createStation(tx, { name: "Delete me" }));
  return { v, id };
}
async function food(
  v: PartyVenue,
  id: string,
  flags: {
    state?: "queued" | "preparing" | "ready";
    held?: boolean;
    retained?: boolean;
    madeHere?: boolean;
    served?: boolean;
    collected?: boolean;
    servedQuantity?: number;
    ticketQuantity?: number;
    status?: "open" | "settled" | "abandoned";
    ticket?: boolean;
  } = {},
) {
  return inTx(v, async (tx) => {
    const order = await seedWorkingOrder(tx, {
      ...v.cfg.origin,
      nodeId: v.cfg.nodeId,
      orderNumber: 42,
      label: "Table 8",
      status: "open",
      settledAt: null,
      collectedAt: flags.collected ? at : null,
    });
    const [line] = await tx
      .insert(workingOrderLines)
      .values({
        workingOrderId: order.id,
        lineNo: 1,
        name: "Flan",
        descriptions: { "es-ES": "Flan de huevo" },
        quantity: 1000,
        unitPriceGross: 500,
        lineTotal: 500,
        vatClass: "general",
        productId: v.productId("Flan"),
        makeAtStationId: id,
        servedAt: flags.served ? at : null,
        servedQuantity: flags.servedQuantity ?? (flags.served ? 1000 : 0),
        sentAt: flags.ticket === false ? null : at,
      })
      .returning();
    if (flags.ticket !== false)
      await tx.insert(ticketItems).values({
        nodeId: v.cfg.nodeId,
        workingOrderId: order.id,
        workingOrderLineId: line!.id,
        stationId: id,
        state: flags.state ?? "queued",
        quantity: flags.ticketQuantity ?? null,
        firedAt: flags.held ? null : at,
        stationRetainedAtRelease: flags.retained ?? false,
        madeHere: flags.madeHere ?? false,
      });
    if (flags.status && flags.status !== "open")
      await tx
        .update(workingOrders)
        .set({ status: flags.status, settledAt: flags.status === "settled" ? at : null })
        .where(eq(workingOrders.id, order.id));
    return { order: order, line: line! };
  });
}
async function binding(v: PartyVenue, id: string) {
  return inTx(v, async (tx) => {
    const [profile] = await seedDeviceProfiles(tx, { name: "Display profile", formFactor: "kds" });
    await setProfileKitchenScreens(tx, profile!.id, {
      station: { stationIds: null, zoneIds: null },
    });
    const { deviceId } = await seedDevice(tx, { profileId: profile!.id, label: "Bound display" });
    await setDeviceKitchenScreens(tx, {
      deviceId,
      profileId: profile!.id,
      screens: [{ kind: "station", stationIds: [id], zoneIds: null }],
    });
    return { id: deviceId };
  });
}
async function snapshot(v: PartyVenue) {
  return inTx(v, async (tx) => {
    const result: Record<string, unknown> = {};
    for (const name of [
      "kitchen_stations",
      "station_printers",
      "device_made_here_stations",
      "routing_cells",
      "routing_cell_periods",
      "station_day_states",
      "device_kitchen_screens",
      "device_kitchen_screen_stations",
      "device_kitchen_screen_removals",
      "device_profile_kitchen_screens",
      "device_profile_kitchen_screen_stations",
      "working_orders",
      "working_order_lines",
      "ticket_items",
      "order_drafts",
      "order_draft_lines",
      "order_draft_events",
      "print_jobs",
      "kitchen_print_jobs",
      "kitchen_print_job_lines",
      "kitchen_notices",
      "ticket_item_moves",
      "order_group_hold_stations",
    ]) {
      const { rows } = await tx.execute(sql.raw(`select * from "${name}" order by rowid`));
      result[name] = rows;
    }
    return result;
  });
}

describe("permanent station deletion", () => {
  it("reports all refusals in fixed order and refuses before changing any settings", async () => {
    const { v, id } = await fixture();
    await inTx(v, (tx) => setDefaultStation(tx, id));
    const display = await binding(v, id);
    const { order } = await food(v, id);
    const before = await snapshot(v);
    expect(await inTx(v, (tx) => readStationDeleteImpact(tx, id))).toEqual({
      target: { id, name: "Delete me" },
      refusals: [
        {
          code: "station.is_default",
          params: { stationId: id },
          targets: [{ id, name: "Delete me" }],
        },
        {
          code: "station.screen_in_use",
          params: { stationId: id, count: 1 },
          targets: [{ id: display.id, name: "Bound display" }],
        },
        {
          code: "station.work_in_progress",
          params: { stationId: id, count: 1 },
          targets: [{ id: order.id, name: "Table 8" }],
        },
      ],
      ends: [],
      removes: [
        {
          key: "station_device_screens",
          count: 1,
          targets: [{ id: display.id, name: "Bound display" }],
        },
      ],
    });
    await expect(inTx(v, (tx) => deleteStation(tx, id))).rejects.toMatchObject({
      code: "station.is_default",
      params: { stationId: id },
    });
    expect(await snapshot(v)).toEqual(before);
  });
  it.each([
    ["queued", {}, true],
    ["preparing", { state: "preparing" }, true],
    ["held", { held: true }, true],
    ["retained held", { held: true, retained: true }, true],
    ["settled uncollected", { status: "settled" }, true],
    ["held ready", { held: true, state: "ready" }, true],
    ["made here", { madeHere: true }, false],
    ["fired ready", { state: "ready" }, false],
    ["served", { served: true }, false],
    ["collected", { collected: true }, false],
    ["abandoned", { status: "abandoned" }, false],
    ["fully cancelled queued", { ticketQuantity: 0 }, false],
    ["cancelled remainder served", { ticketQuantity: 500, servedQuantity: 500 }, false],
  ] as const)("preparation predicate: %s", async (_name, flags, blocked) => {
    const { v, id } = await fixture();
    const { order } = await food(v, id, flags);
    const before = await snapshot(v);
    const impact = await inTx(v, (tx) => readStationDeleteImpact(tx, id));
    expect(impact.refusals).toEqual(
      blocked
        ? [
            {
              code: "station.work_in_progress",
              params: { stationId: id, count: 1 },
              targets: [{ id: order.id, name: "Table 8" }],
            },
          ]
        : [],
    );
    if (blocked) {
      await expect(inTx(v, (tx) => deleteStation(tx, id))).rejects.toMatchObject({
        code: "station.work_in_progress",
        params: { stationId: id, count: 1 },
      });
      expect(await snapshot(v)).toEqual(before);
    } else {
      await inTx(v, (tx) => deleteStation(tx, id));
      const after = await snapshot(v);
      expect(after.ticket_items).toEqual(before.ticket_items);
      expect(after.working_order_lines).toEqual(before.working_order_lines);
    }
  });
  it.each(["default", "screen", "ticket"] as const)(
    "rechecks a new %s after the impact read",
    async (kind) => {
      const { v, id } = await fixture();
      expect((await inTx(v, (tx) => readStationDeleteImpact(tx, id))).refusals).toEqual([]);
      if (kind === "default") await inTx(v, (tx) => setDefaultStation(tx, id));
      if (kind === "screen") await binding(v, id);
      if (kind === "ticket") await food(v, id);
      const before = await snapshot(v);
      await expect(inTx(v, (tx) => deleteStation(tx, id))).rejects.toMatchObject({
        code:
          kind === "default"
            ? "station.is_default"
            : kind === "screen"
              ? "station.screen_in_use"
              : "station.work_in_progress",
        params: { stationId: id, ...(kind === "default" ? {} : { count: 1 }) },
      });
      expect(await snapshot(v)).toEqual(before);
    },
  );
  it("marks a deleted device's retained made-here choice", async () => {
    const { v, id } = await fixture();
    await inTx(v, async (tx) => {
      await tx
        .update(devices)
        .set({ label: "Terrace" })
        .where(eq(devices.id, v.cfg.origin.deviceId));
      await tx
        .insert(deviceMadeHereStations)
        .values({ stationId: id, deviceId: v.cfg.origin.deviceId });
      await deleteDevice(tx, v.cfg, v.cfg.origin.deviceId);
    });
    const impact = await inTx(v, (tx) => readStationDeleteImpact(tx, id));
    expect(impact.removes.find((item) => item.key === "station_made_here")?.targets).toEqual([
      { id: v.cfg.origin.deviceId, name: "Terrace", deleted: true },
    ]);
  });

  it("clears eligible choices and core settings, bumps revisions once, and retains history", async () => {
    const { v, id } = await fixture();
    const first = await food(v, id, { ticket: false });
    const ready = await food(v, id, { state: "ready" });
    const { partyId, tabId } = await seat(v, await v.table("Draft"));
    await inTx(v, (tx) =>
      saveDraft(tx, v.cfg, partyId, OPERATOR, {
        billId: tabId,
        draftId: null,
        revision: 0,
        lines: [
          {
            menuItemId: v.item("Flan"),
            variantId: null,
            menuVersionId: null,
            options: [],
            extras: [],
            note: null,
            quantity: "1",
            courseId: null,
            makeAt: id,
            noMerge: false,
          },
        ],
      }),
    );
    const beforeQueue = await inTx(v, (tx) => listStationQueue(tx, id));
    const beforeRest = await inTx(v, (tx) => readRestOfOrder(tx, [ready.order.id]));
    const beforeDrafts = await inTx(v, (tx) => tx.select().from(orderDrafts));
    const beforeEvents = await inTx(v, (tx) => tx.select().from(orderDraftEvents));
    expect((await inTx(v, (tx) => readStationDeleteImpact(tx, id))).removes).toEqual([
      { key: "station_unsent_lines", count: 1, targets: [] },
      { key: "station_draft_lines", count: 1, targets: [] },
    ]);
    const [printer] = await inTx(v, (tx) =>
      tx
        .insert(printers)
        .values({
          name: "Kitchen",
          transport: "cloud_poll",
          pollId: randomUUID(),
        })
        .returning(),
    );
    await inTx(v, async (tx) => {
      await tx.insert(stationPrinters).values({ stationId: id, printerId: printer!.id });
      await tx
        .insert(deviceMadeHereStations)
        .values({ stationId: id, deviceId: v.cfg.origin.deviceId });
    });
    const [sender] = await inTx(v, (tx) =>
      tx.select().from(devices).where(eq(devices.id, v.cfg.origin.deviceId)),
    );
    const impact = await inTx(v, (tx) => deleteStation(tx, id, new Date(at)));
    expect(impact).toEqual({
      target: { id, name: "Delete me" },
      refusals: [],
      ends: [],
      removes: [
        { key: "station_unsent_lines", count: 1, targets: [] },
        { key: "station_draft_lines", count: 1, targets: [] },
        { key: "station_printers", count: 1, targets: [{ id: printer!.id, name: "Kitchen" }] },
        { key: "station_made_here", count: 1, targets: [{ id: sender!.id, name: sender!.label }] },
      ],
    });
    expect(
      await inTx(v, (tx) =>
        tx.select().from(workingOrderLines).where(eq(workingOrderLines.id, first.line.id)),
      ),
    ).toEqual([{ ...first.line, makeAtStationId: null }]);
    expect(
      await inTx(v, (tx) =>
        tx.select().from(workingOrders).where(eq(workingOrders.id, first.order.id)),
      ),
    ).toEqual([{ ...first.order, revision: first.order.revision + 1 }]);
    expect(
      await inTx(v, (tx) =>
        tx.select().from(workingOrderLines).where(eq(workingOrderLines.id, ready.line.id)),
      ),
    ).toEqual([ready.line]);
    expect(await inTx(v, (tx) => tx.select().from(orderDrafts))).toEqual(
      beforeDrafts.map((row) => ({ ...row, revision: row.revision + 1, updatedAt: at })),
    );
    expect(
      (await inTx(v, (tx) => tx.select().from(orderDraftLines))).map((row) => row.makeAtStationId),
    ).toEqual([null]);
    expect(await inTx(v, (tx) => tx.select().from(orderDraftEvents))).toEqual(beforeEvents);
    expect(await inTx(v, (tx) => listStationQueue(tx, id))).toEqual(beforeQueue);
    expect(await inTx(v, (tx) => readRestOfOrder(tx, [ready.order.id]))).toEqual(beforeRest);
    expect(beforeRest.get(ready.order.id)!.map((row) => row.stationName)).toEqual(["Delete me"]);
    await expect(
      updateHeldOrder({ admission: testTradingAdmission(), db: v.db }, v.cfg, first.order.id, {
        revision: first.order.revision,
        lines: [],
      }),
    ).rejects.toMatchObject({
      code: "working_order.out_of_date",
      params: { workingOrderId: first.order.id, revision: first.order.revision + 1 },
    });
    const draft = beforeDrafts[0]!;
    await expect(
      inTx(v, (tx) =>
        saveDraft(tx, v.cfg, partyId, OPERATOR, {
          billId: draft.billId,
          draftId: draft.id,
          revision: draft.revision,
          lines: [],
        }),
      ),
    ).rejects.toMatchObject({
      code: "draft.out_of_date",
      params: { draftId: draft.id, revision: draft.revision + 1 },
    });
    for (const table of [stationPrinters, deviceMadeHereStations])
      expect(await inTx(v, (tx) => tx.select().from(table))).toEqual([]);
    expect((await inTx(v, (tx) => listStations(tx))).some((row) => row.id === id)).toBe(false);
    for (const action of [
      () => inTx(v, (tx) => deleteStation(tx, id)),
      () => inTx(v, (tx) => updateStation(tx, id, {})),
      () => inTx(v, (tx) => setDefaultStation(tx, id)),
      () => inTx(v, (tx) => listStationPrinters(tx, { stationId: id })),
    ])
      await expect(action()).rejects.toMatchObject({
        code: "station.not_found",
        params: { stationId: id },
      });
    await inTx(v, (tx) => createStation(tx, { name: "Delete me" }));
  });
  it("removes module settings without changing other stations or dates", async () => {
    const { v, id } = await fixture();
    const otherId = (await inTx(v, (tx) => createStation(tx, { name: "Surviving station" }))).id;
    const ownedCell = randomUUID(),
      survivingCell = randomUUID();
    await inTx(v, async (tx) => {
      await tx.execute(
        sql`insert into routing_cells (id, no_category, station_id, product_id) values (${ownedCell}, 1, ${id}, null), (${survivingCell},0,${otherId},${v.productId("Flan")})`,
      );
      await tx.execute(
        sql`insert into station_day_states (id,station_id,business_day,open,sends_to_station_id) values (${randomUUID()},${id},'2026-10-09',0,null), (${randomUUID()},${id},'2026-10-10',0,null), (${randomUUID()},${otherId},'2026-10-10',0,${id})`,
      );
    });
    const before = await snapshot(v);
    const impact = await inTx(v, (tx) => deleteStation(tx, id));
    expect(impact).toEqual({
      target: { id, name: "Delete me" },
      refusals: [],
      ends: [],
      removes: [
        { key: "station_routing_cells", count: 1, targets: [] },
        { key: "station_daily_states", count: 2, targets: [] },
        {
          key: "station_daily_destinations",
          count: 1,
          targets: [{ id: otherId, name: "Surviving station" }],
        },
      ],
    });
    const after = await snapshot(v);
    expect(after.routing_cells).toEqual(
      (before.routing_cells as { id: string }[]).filter((row) => row.id !== ownedCell),
    );
    expect(after.station_day_states).toEqual(
      (before.station_day_states as { station_id: string; sends_to_station_id: string | null }[])
        .filter((row) => row.station_id !== id)
        .map((row) =>
          row.sends_to_station_id === id ? { ...row, sends_to_station_id: null } : row,
        ),
    );
    expect(after.kitchen_stations).toEqual(
      (before.kitchen_stations as { id: string; active: number }[]).map((row) =>
        row.id === id ? { ...row, active: 0 } : row,
      ),
    );
    for (const key of [
      "ticket_items",
      "ticket_item_moves",
      "kitchen_notices",
      "print_jobs",
      "kitchen_print_jobs",
      "kitchen_print_job_lines",
      "order_draft_events",
    ])
      expect(after[key]).toEqual(before[key]);
  });
  it("deletes a station and clears an unsent dish's make-at while a card is at the reader for its order", async () => {
    const { v, id } = await fixture();
    const unsent = await food(v, id, { ticket: false });
    await inTx(v, (tx) =>
      tx
        .update(workingOrders)
        .set({ paymentAttemptAt: at })
        .where(eq(workingOrders.id, unsent.order.id)),
    );
    expect((await inTx(v, (tx) => deleteStation(tx, id, new Date(at)))).refusals).toEqual([]);
    expect((await inTx(v, (tx) => listStations(tx))).some((row) => row.id === id)).toBe(false);
    const [line] = await inTx(v, (tx) =>
      tx.select().from(workingOrderLines).where(eq(workingOrderLines.id, unsent.line.id)),
    );
    expect(line!.makeAtStationId).toBeNull();
    const [order] = await inTx(v, (tx) =>
      tx.select().from(workingOrders).where(eq(workingOrders.id, unsent.order.id)),
    );
    expect(order!.paymentAttemptAt).toBe(at);
    expect(order!.revision).toBe(unsent.order.revision + 1);
  });
  it("leaves finished unsent orders and closed drafts unchanged and increments each affected parent once", async () => {
    const { v, id } = await fixture();
    const unsent = await food(v, id, { ticket: false });
    const finished = await food(v, id, { ticket: false, status: "settled" });
    const { partyId } = await seat(v, await v.table("Multiple choices"));
    await inTx(v, async (tx) => {
      await tx.insert(workingOrderLines).values({ ...unsent.line, id: randomUUID(), lineNo: 2 });
      for (const state of ["open", "submitted", "discarded"] as const) {
        const [draft] = await tx
          .insert(orderDrafts)
          .values({ partyId, ownerId: state === "open" ? OPERATOR : randomUUID(), state })
          .returning();
        for (const position of [0, 1])
          await tx.insert(orderDraftLines).values({
            draftId: draft!.id,
            position,
            menuItemId: v.item("Flan"),
            options: [],
            extras: [],
            quantity: 1000,
            makeAtStationId: id,
          });
      }
    });
    const before = await snapshot(v);
    expect((await inTx(v, (tx) => deleteStation(tx, id, new Date(at)))).removes).toEqual([
      { key: "station_unsent_lines", count: 2, targets: [] },
      { key: "station_draft_lines", count: 2, targets: [] },
    ]);
    expect(
      await inTx(v, (tx) =>
        tx.select().from(workingOrderLines).where(eq(workingOrderLines.id, finished.line.id)),
      ),
    ).toEqual([finished.line]);
    expect(
      (
        await inTx(v, (tx) =>
          tx.select().from(workingOrders).where(eq(workingOrders.id, unsent.order.id)),
        )
      )[0]!.revision,
    ).toBe(unsent.order.revision + 1);
    const after = await snapshot(v);
    const openIds = new Set(
      (before.order_drafts as { id: string; state: string }[])
        .filter((row) => row.state === "open")
        .map((row) => row.id),
    );
    expect(after.order_drafts).toEqual(
      (before.order_drafts as { id: string; revision: number; updated_at: string }[]).map((row) =>
        openIds.has(row.id) ? { ...row, revision: row.revision + 1, updated_at: at } : row,
      ),
    );
    expect(after.order_draft_lines).toEqual(
      (before.order_draft_lines as { draft_id: string; make_at_station_id: string }[]).map((row) =>
        openIds.has(row.draft_id) ? { ...row, make_at_station_id: null } : row,
      ),
    );
  });
  it("keeps ready tickets, move notices and pending or completed kitchen print records exactly", async () => {
    const { v, id } = await fixture();
    const ready = await food(v, id, { state: "ready" });
    const origin = (await inTx(v, (tx) => createStation(tx, { name: "Origin" }))).id;
    await inTx(v, async (tx) => {
      await tx.insert(ticketItemMoves).values({
        workingOrderLineId: ready.line.id,
        fromStationId: origin,
        toStationId: id,
        movedAt: at,
        movedByDeviceId: v.cfg.origin.deviceId,
      });
      await tx.execute(
        sql`insert into kitchen_notices (id,station_id,working_order_id,order_label,kind,line_name,quantity,created_at,rerouted_to) values (${randomUUID()},${id},${ready.order.id},'Table 8','rerouted','Flan',1000,${at},'Origin')`,
      );
      const [printer] = await tx
        .insert(printers)
        .values({
          name: "Historical kitchen",
          transport: "cloud_poll",
          pollId: randomUUID(),
        })
        .returning();
      await tx.insert(stationPrinters).values({ stationId: id, printerId: printer!.id });
      for (const status of ["queued", "printing", "done", "failed"] as const) {
        const [job] = await tx
          .insert(printJobs)
          .values({
            printerId: printer!.id,
            payload: new Uint8Array([1, 2, 3]),
            status,
            deliveredAt: status === "done" ? at : null,
          })
          .returning();
        await tx.insert(kitchenPrintJobs).values({
          printJobId: job!.id,
          workingOrderId: ready.order.id,
          stationId: id,
          reprint: false,
        });
      }
    });
    const before = await snapshot(v);
    const result = await inTx(v, (tx) => deleteStation(tx, id));
    expect(result.ends).toEqual([]);
    const after = await snapshot(v);
    for (const key of [
      "ticket_items",
      "ticket_item_moves",
      "kitchen_notices",
      "print_jobs",
      "kitchen_print_jobs",
      "kitchen_print_job_lines",
      "working_orders",
      "working_order_lines",
    ])
      expect(after[key]).toEqual(before[key]);
    expect(before.ticket_item_moves).toHaveLength(1);
    expect(before.kitchen_notices).toHaveLength(1);
    expect(before.kitchen_print_jobs).toHaveLength(4);
    expect(before.print_jobs).toHaveLength(4);
  });
  it("names seated and joined-table preparation by the tables' full names (orderTableLabels)", async () => {
    const { v, id } = await fixture();
    const single = await seat(v, await v.table("Mesa 4"));
    const multi = await seat(v, await v.table("Mesa 5"));
    await join(v, multi.partyId, await v.table("Mesa 6"));
    const first = await food(v, id);
    const second = await food(v, id);
    await inTx(v, async (tx) => {
      await tx
        .update(workingOrders)
        .set({ partyId: single.partyId, label: null })
        .where(eq(workingOrders.id, first.order.id));
      await tx
        .update(workingOrders)
        .set({ partyId: multi.partyId, label: null })
        .where(eq(workingOrders.id, second.order.id));
    });
    expect((await inTx(v, (tx) => readStationDeleteImpact(tx, id))).refusals).toEqual([
      {
        code: "station.work_in_progress",
        params: { stationId: id, count: 2 },
        targets: [
          { id: first.order.id, name: "Mesa 4" },
          { id: second.order.id, name: "Mesa 5, 6" },
        ],
      },
    ]);
  });
  it.each([true, false, null, undefined, "false", 0])(
    "rejects an own active key of %s",
    async (active) => {
      const { v, id } = await fixture();
      await expect(
        inTx(v, (tx) => updateStation(tx, id, { active } as never)),
      ).rejects.toMatchObject({ code: "management.request_invalid", params: { field: "active" } });
    },
  );
  it("keeps a deleted station's late flags on its row", async () => {
    const { v, id } = await fixture();
    await inTx(v, (tx) =>
      tx
        .update(kitchenStations)
        .set({ warmAfterMinutes: 2, overdueAfterMinutes: 4, forgottenAfterMinutes: 6 })
        .where(eq(kitchenStations.id, id)),
    );
    await inTx(v, (tx) => deleteStation(tx, id));
    expect(
      await inTx(v, (tx) =>
        tx
          .select({
            active: kitchenStations.active,
            warmAfterMinutes: kitchenStations.warmAfterMinutes,
            overdueAfterMinutes: kitchenStations.overdueAfterMinutes,
            forgottenAfterMinutes: kitchenStations.forgottenAfterMinutes,
          })
          .from(kitchenStations)
          .where(eq(kitchenStations.id, id)),
      ),
    ).toEqual([
      { active: false, warmAfterMinutes: 2, overdueAfterMinutes: 4, forgottenAfterMinutes: 6 },
    ]);
  });
  it("rolls back a failure after module/settings removal", async () => {
    const { v, id } = await fixture();
    const before = await snapshot(v);
    await expect(
      inTx(v, async (tx) => {
        await deleteStation(tx, id);
        throw new Error("injected after deletion");
      }),
    ).rejects.toThrow("injected after deletion");
    expect(await snapshot(v)).toEqual(before);
  });
  it("refuses unknown ids", async () => {
    const { v } = await fixture();
    for (const target of [randomUUID()])
      for (const read of [readStationDeleteImpact, deleteStation])
        await expect(inTx(v, (tx) => read(tx, target))).rejects.toMatchObject({
          code: "station.not_found",
          params: { stationId: target },
        });
  });
});

describe("A773 no dispatch state", () => {
  it.each([
    ["unserved", 0, 1000, 1, "1.000"],
    ["partly served", 250, 1000, 1, "0.750"],
    ["partly cancelled and served", 250, 500, 1, "0.250"],
    ["served without timestamp", 1000, 1000, 0, null],
    ["cancelled remainder served", 500, 500, 0, null],
    ["fully cancelled", 0, 0, 0, null],
  ] as const)(
    "counts and lists only active remaining food: %s",
    async (_label, servedQuantity, ticketQuantity, count, quantity) => {
      const { v, id } = await fixture();
      const { order } = await food(v, id, {
        state: "ready",
        servedQuantity,
        ticketQuantity,
      });
      const before = await snapshot(v);
      expect(await inTx(v, (tx) => openDishCount(tx, id))).toBe(count);
      const rest = (await inTx(v, (tx) => readRestOfOrder(tx, [order.id]))).get(order.id)!;
      expect(rest.map((row) => row.quantity)).toEqual(quantity === null ? [] : [quantity]);
      expect(await snapshot(v)).toEqual(before);
    },
  );

  it("requires a closing choice for a ready dish", async () => {
    const { v, id } = await fixture();
    await food(v, id, { state: "ready" });
    const destination = await inTx(v, (tx) => createStation(tx, { name: "Destination" }));
    const before = await snapshot(v);
    await expect(
      inTx(v, (tx) =>
        withStationDishes(
          tx,
          v.cfg,
          id,
          destination.id,
          undefined,
          (at) => closeStationForToday(tx, id, destination.id, at),
          { deviceId: v.cfg.origin.deviceId, personId: OPERATOR },
        ),
      ),
    ).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "openDishes" },
    });
    expect(await snapshot(v)).toEqual(before);
  });

  it("closing sends only queued unserved food and retains started work", async () => {
    const { v, id } = await fixture();
    const destination = await inTx(v, (tx) => createStation(tx, { name: "Destination" }));
    const queued = await food(v, id);
    const preparing = await food(v, id, { state: "preparing" });
    const ready = await food(v, id, { state: "ready" });
    const served = await food(v, id, { served: true });
    const made = await food(v, id, { madeHere: true });
    await inTx(v, (tx) =>
      withStationDishes(
        tx,
        v.cfg,
        id,
        destination.id,
        "send",
        (at) => closeStationForToday(tx, id, destination.id, at),
        { deviceId: v.cfg.origin.deviceId, personId: OPERATOR },
      ),
    );
    const items = await inTx(v, (tx) => tx.select().from(ticketItems));
    for (const { line } of [queued, preparing, ready, served, made])
      expect(items.find((item) => item.workingOrderLineId === line.id)?.stationId).toBe(
        line.id === queued.line.id ? destination.id : id,
      );
    expect(
      await inTx(v, (tx) =>
        tx.select({ lineId: ticketItemMoves.workingOrderLineId }).from(ticketItemMoves),
      ),
    ).toEqual([{ lineId: queued.line.id }]);
  });
});
