import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { incidents, workingOrderLines, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { markIncidentHandled } from "@waitron/core";
import { createStation } from "./kitchen.js";
import { inTx, orderForParty, seat, setupPartyVenue } from "./testing/party-venue.js";
import { raiseReleasedAtClosedStation } from "./closed-station-alert.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

it("records one release alert with staff names in line order until the open alert is handled", async () => {
  const venue = await setupPartyVenue(suite.db);
  const station = await inTx(venue, (tx) =>
    createStation(tx, { name: "Upstairs bar", isDefault: true }),
  );
  const tableId = await venue.table(`A-${randomUUID().slice(0, 8)}`);
  const { partyId, tabId } = await seat(venue, tableId);
  await orderForParty(venue, partyId, ["Burger", "Red wine bottle", "Burger"], tabId);
  const lines = await inTx(venue, (tx) =>
    tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo),
  );
  const [order] = await inTx(venue, (tx) =>
    tx
      .select({ number: workingOrders.orderNumber, label: workingOrders.label })
      .from(workingOrders)
      .where(eq(workingOrders.id, tabId)),
  );
  const at = new Date("2026-10-02T18:45:00.000Z");
  const stranded = [
    {
      stationId: station.id,
      stationName: "Upstairs bar",
      lineIds: [lines[0]!.id, lines[1]!.id, lines[2]!.id],
    },
  ];
  await inTx(venue, (tx) => raiseReleasedAtClosedStation(tx, venue.cfg, tabId, at, stranded));
  let alerts = await inTx(venue, (tx) =>
    tx.select().from(incidents).where(eq(incidents.code, "route.released_at_closed_station")),
  );
  expect(alerts).toHaveLength(1);
  expect(alerts[0]).toMatchObject({
    source: "device",
    deviceId: venue.cfg.origin.deviceId,
    saleId: null,
    severity: "error",
    detectedAt: at.toISOString(),
    acknowledgedAt: null,
    params: {
      station: "Upstairs bar",
      dishes: "Burger, Red wine bottle",
      workingOrderId: tabId,
      orderNumber: order!.number,
      orderLabel: order!.label,
    },
  });
  await inTx(venue, (tx) =>
    raiseReleasedAtClosedStation(tx, venue.cfg, tabId, new Date(at.getTime() + 1000), stranded),
  );
  alerts = await inTx(venue, (tx) =>
    tx.select().from(incidents).where(eq(incidents.code, "route.released_at_closed_station")),
  );
  expect(alerts).toHaveLength(1);
  await inTx(venue, (tx) =>
    markIncidentHandled(tx, {
      id: alerts[0]!.id,
      personId: "staff",
      handledAt: new Date(at.getTime() + 2000),
    }),
  );
  await inTx(venue, (tx) =>
    raiseReleasedAtClosedStation(tx, venue.cfg, tabId, new Date(at.getTime() + 3000), [
      { stationId: station.id, stationName: "Upstairs bar", lineIds: [lines[2]!.id, lines[0]!.id] },
      { stationId: randomUUID(), stationName: "Fryer", lineIds: [lines[1]!.id] },
    ]),
  );
  alerts = await inTx(venue, (tx) =>
    tx.select().from(incidents).where(eq(incidents.code, "route.released_at_closed_station")),
  );
  expect(alerts).toHaveLength(2);
  expect(alerts.filter((alert) => alert.acknowledgedAt === null)).toEqual([
    expect.objectContaining({
      params: expect.objectContaining({
        station: "Upstairs bar, Fryer",
        dishes: "Burger, Red wine bottle",
      }),
    }),
  ]);
});

it("does not mistake an unrelated 1811 refusal for an expected alert constraint", async () => {
  const venue = await setupPartyVenue(suite.db);
  const station = await inTx(venue, (tx) =>
    createStation(tx, { name: "Upstairs bar", isDefault: true }),
  );
  const tableId = await venue.table(`A-${randomUUID().slice(0, 8)}`);
  const { partyId, tabId } = await seat(venue, tableId);
  await orderForParty(venue, partyId, ["Burger"], tabId);
  const [line] = await inTx(venue, (tx) =>
    tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId)),
  );
  await suite.db.execute(sql`
    create trigger refuse_station_alert before insert on incidents
    when new.code = 'route.released_at_closed_station'
    begin select raise(abort, 'FOREIGN KEY constraint failed'); end
  `);
  try {
    await expect(
      inTx(venue, (tx) =>
        raiseReleasedAtClosedStation(tx, venue.cfg, tabId, new Date(), [
          { stationId: station.id, stationName: "Upstairs bar", lineIds: [line!.id] },
        ]),
      ),
    ).rejects.toThrow("FOREIGN KEY constraint failed");
  } finally {
    await suite.db.execute(sql`drop trigger refuse_station_alert`);
  }
});

it("records the waiting-for-the-pass alert under its own code, without the order's label", async () => {
  const venue = await setupPartyVenue(suite.db);
  const station = await inTx(venue, (tx) => createStation(tx, { name: "Fryer", isDefault: true }));
  const tableId = await venue.table(`A-${randomUUID().slice(0, 8)}`);
  const { partyId, tabId } = await seat(venue, tableId);
  await orderForParty(venue, partyId, ["Burger"], tabId);
  const [line] = await inTx(venue, (tx) =>
    tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId)),
  );
  const [order] = await inTx(venue, (tx) =>
    tx
      .select({ number: workingOrders.orderNumber })
      .from(workingOrders)
      .where(eq(workingOrders.id, tabId)),
  );
  const at = new Date("2026-10-02T18:45:00.000Z");
  await inTx(venue, (tx) =>
    raiseReleasedAtClosedStation(
      tx,
      venue.cfg,
      tabId,
      at,
      [],
      [{ stationId: station.id, stationName: "Fryer", lineIds: [line!.id] }],
    ),
  );
  const alerts = await inTx(venue, (tx) =>
    tx
      .select()
      .from(incidents)
      .then((rows) => rows.filter((row) => row.params.workingOrderId === tabId)),
  );
  expect(alerts).toHaveLength(1);
  expect(alerts[0]).toMatchObject({
    code: "route.waiting_at_closed_station",
    severity: "error",
    detectedAt: at.toISOString(),
  });
  expect(alerts[0]!.params).toEqual({
    station: "Fryer",
    dishes: "Burger",
    workingOrderId: tabId,
    orderNumber: order!.number,
  });
});

it("raises both alerts from one call, each naming only its own stations and dishes", async () => {
  const venue = await setupPartyVenue(suite.db);
  const bar = await inTx(venue, (tx) =>
    createStation(tx, { name: "Upstairs bar", isDefault: true }),
  );
  const fryer = await inTx(venue, (tx) => createStation(tx, { name: "Fryer" }));
  const tableId = await venue.table(`A-${randomUUID().slice(0, 8)}`);
  const { partyId, tabId } = await seat(venue, tableId);
  await orderForParty(venue, partyId, ["Burger", "Red wine bottle", "Paella"], tabId);
  const lines = await inTx(venue, (tx) =>
    tx
      .select({ id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, tabId))
      .orderBy(workingOrderLines.lineNo),
  );
  const [order] = await inTx(venue, (tx) =>
    tx
      .select({ number: workingOrders.orderNumber, label: workingOrders.label })
      .from(workingOrders)
      .where(eq(workingOrders.id, tabId)),
  );
  await inTx(venue, (tx) =>
    raiseReleasedAtClosedStation(
      tx,
      venue.cfg,
      tabId,
      new Date("2026-10-02T18:45:00.000Z"),
      [{ stationId: bar.id, stationName: "Upstairs bar", lineIds: [lines[1]!.id] }],
      [{ stationId: fryer.id, stationName: "Fryer", lineIds: [lines[2]!.id, lines[0]!.id] }],
    ),
  );
  const alerts = await inTx(venue, (tx) =>
    tx
      .select()
      .from(incidents)
      .then((rows) => rows.filter((row) => row.params.workingOrderId === tabId)),
  );
  expect(alerts).toHaveLength(2);
  expect(Object.fromEntries(alerts.map((alert) => [alert.code, alert.params]))).toEqual({
    "route.released_at_closed_station": {
      station: "Upstairs bar",
      dishes: "Red wine bottle",
      workingOrderId: tabId,
      orderNumber: order!.number,
      orderLabel: order!.label,
    },
    "route.waiting_at_closed_station": {
      station: "Fryer",
      dishes: "Burger, Paella",
      workingOrderId: tabId,
      orderNumber: order!.number,
    },
  });
});
