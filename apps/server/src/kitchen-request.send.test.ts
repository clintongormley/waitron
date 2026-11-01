import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  deviceMadeHereStations,
  deviceProfiles,
  devices,
  parties,
  printJobs,
  ticketItems,
  withTransaction,
  workingOrderLines,
} from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createProduct, readContentLanguages } from "@waitron/catalogue";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  fireNewOrder,
  setupSplitExtrasVenue,
  useSplitExtrasDb,
} from "./testing/split-extras-venue.js";
import { setStationsWaitForPass } from "./testing/pass-waiting.js";
import { submitGroups } from "./testing/group-submit-fixture.js";
import { addTabRound, recallLines } from "./testing/order-writer-fixture.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { offerProducts } from "./testing/zone-offers.js";
import { OPERATOR } from "./testing/party-venue.js";
import { kitchenPhase } from "./kitchen-phase.js";
import { VENUE_SERVICE } from "./modules.js";
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

type Venue = Awaited<ReturnType<typeof setupSplitExtrasVenue>>;

async function items(tx: Transaction, orderId: string) {
  return tx
    .select({
      id: ticketItems.id,
      lineId: ticketItems.workingOrderLineId,
      stationId: ticketItems.stationId,
      requestedAt: ticketItems.requestedAt,
      firedAt: ticketItems.firedAt,
      passControlled: ticketItems.passControlled,
      state: ticketItems.state,
      queuedAt: ticketItems.queuedAt,
      readyAt: ticketItems.readyAt,
    })
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderId, orderId));
}

async function jobsAt(tx: Transaction, printerId: string) {
  return (
    await tx
      .select({ payload: printJobs.payload })
      .from(printJobs)
      .where(eq(printJobs.printerId, printerId))
  ).map((job) => decodeTicket(job.payload));
}

async function jobCounts(tx: Transaction, venue: Venue) {
  const counts: Record<string, number> = {};
  for (const [name, id] of Object.entries(venue.printers))
    counts[name] = (await jobsAt(tx, id)).length;
  return counts;
}

/** A product with no routing cell, so it goes to the default station, Kitchen. */
async function kitchenDish(tx: Transaction, venue: Venue): Promise<string> {
  const { defaultLanguage } = await readContentLanguages(tx, venue.cfg.locale);
  return (
    await createProduct(tx, {
      catalogueId: venue.catalogueId,
      categoryId: venue.folders.food,
      name: "Salad",
      customerName: { [defaultLanguage]: "Garden salad" },
      kitchenName: "SALAD",
      pricingUnit: "each",
      unitPrice: "1.00",
      vatClass: "general",
    })
  ).id;
}

async function partyRevision(tx: Transaction, partyId: string): Promise<number> {
  const [row] = await tx
    .select({ revision: parties.revision })
    .from(parties)
    .where(eq(parties.id, partyId));
  return row!.revision;
}

const burgerLine = (venue: Venue) => ({
  menuItemId: venue.tables.offerFor(venue.products.burger),
  quantity: "1",
});

describe("A773 waiter request: send", () => {
  it("requests a new dish at a waiting station and releases the rest, printing only the released", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      const salad = await kitchenDish(tx, venue);
      const orderId = await fireNewOrder(tx, venue.cfg, [
        { productId: venue.products.burger, quantity: "1" },
        { productId: salad, quantity: "1" },
      ]);
      const rows = await items(tx, orderId);
      expect(rows).toHaveLength(2);
      const burger = rows.find((row) => row.stationId === venue.stations.grill)!;
      const kitchen = rows.find((row) => row.stationId === venue.stations.kitchen)!;
      expect(burger).toEqual({
        ...burger,
        requestedAt: expect.any(String),
        firedAt: null,
        passControlled: true,
        state: "queued",
        readyAt: null,
      });
      expect(kitchenPhase(burger)).toBe("requested");
      expect(kitchen).toEqual({
        ...kitchen,
        requestedAt: kitchen.firedAt,
        firedAt: expect.any(String),
        passControlled: false,
        state: "queued",
        readyAt: null,
      });
      expect(await jobCounts(tx, venue)).toEqual({
        grill: 0,
        fryer: 0,
        kitchen: 1,
        bar: 0,
        pass: 0,
      });
      expect((await jobsAt(tx, venue.printers.kitchen))[0]).toContain("SALAD");
    });
  });

  it("releases at once when nothing waits: one item per line, one job at each output", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      const salad = await kitchenDish(tx, venue);
      const orderId = await fireNewOrder(tx, venue.cfg, [
        { productId: venue.products.burger, quantity: "1" },
        { productId: salad, quantity: "1" },
      ]);
      const rows = await items(tx, orderId);
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.lineId)).size).toBe(2);
      for (const row of rows)
        expect(row).toEqual({
          ...row,
          requestedAt: row.firedAt,
          firedAt: expect.any(String),
          passControlled: false,
          state: "queued",
          readyAt: null,
        });
      expect(await jobCounts(tx, venue)).toEqual({
        grill: 1,
        fryer: 0,
        kitchen: 1,
        bar: 0,
        pass: 1,
      });
      expect((await jobsAt(tx, venue.printers.grill))[0]).toContain("BURG");
      expect((await jobsAt(tx, venue.printers.pass))[0]).toContain("BURG");
      expect((await jobsAt(tx, venue.printers.kitchen))[0]).toContain("SALAD");
    });
  });

  it("on a table, requests the Fire now dish, sends its line and freezes its allergies; a held dish stays held", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      await submitGroups(tx, venue.cfg, venue.party.partyId, {
        submissionId: randomUUID(),
        expectedPartyRevision: await partyRevision(tx, venue.party.partyId),
        operatorId: OPERATOR,
        groups: [
          { lines: [burgerLine(venue)], release: "fire" },
          { lines: [burgerLine(venue)], release: "hold" },
        ],
      });
      const rows = await items(tx, venue.party.tabId);
      expect(rows).toHaveLength(2);
      const requested = rows.find((row) => row.requestedAt !== null)!;
      const held = rows.find((row) => row.id !== requested?.id)!;
      expect(requested).toEqual({
        ...requested,
        requestedAt: expect.any(String),
        firedAt: null,
        passControlled: true,
        state: "queued",
      });
      expect(held).toEqual({
        ...held,
        requestedAt: null,
        firedAt: null,
        passControlled: false,
        state: "queued",
      });
      const sent = new Map(
        (
          await tx
            .select({ id: workingOrderLines.id, sentAt: workingOrderLines.sentAt })
            .from(workingOrderLines)
            .where(eq(workingOrderLines.workingOrderId, venue.party.tabId))
        ).map((line) => [line.id, line.sentAt]),
      );
      expect(sent.get(requested.lineId)).toEqual(expect.any(String));
      expect(sent.get(held.lineId)).toBeNull();
      expect((await VENUE_SERVICE.readTicketAllergies(tx, [requested.id])).has(requested.id)).toBe(
        true,
      );
      expect(await jobCounts(tx, venue)).toMatchObject({ grill: 0, pass: 0 });
    });
  });

  it("made here wins: a held dish at a waiting made-here station is ready at once and prints nothing", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      const [profile] = await tx
        .insert(deviceProfiles)
        .values({ name: "Grill till", formFactor: "till", capabilities: [] })
        .returning({ id: deviceProfiles.id });
      const [device] = await tx
        .insert(devices)
        .values({
          locationId: venue.cfg.locationId,
          deviceProfileId: profile!.id,
          label: "Grill till",
          tokenHash: `grill-${randomUUID()}`,
        })
        .returning({ id: devices.id });
      await tx
        .insert(deviceMadeHereStations)
        .values({ deviceId: device!.id, stationId: venue.stations.grill });
      await submitGroups(tx, { ...venue.cfg, sendingDeviceId: device!.id }, venue.party.partyId, {
        submissionId: randomUUID(),
        expectedPartyRevision: await partyRevision(tx, venue.party.partyId),
        operatorId: OPERATOR,
        groups: [{ lines: [burgerLine(venue)], release: "hold" }],
      });
      const [burger] = await items(tx, venue.party.tabId);
      expect(burger).toEqual({
        ...burger,
        requestedAt: burger!.readyAt,
        firedAt: burger!.readyAt,
        readyAt: expect.any(String),
        passControlled: false,
        state: "ready",
      });
      expect(Object.values(await jobCounts(tx, venue)).every((count) => count === 0)).toBe(true);
    });
  });

  it("a replayed submission answers the first answer and stamps and prints nothing more", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await setStationsWaitForPass(tx, true, [venue.stations.grill]);
      const salad = await kitchenDish(tx, venue);
      const offers = await offerProducts(tx, venue.cfg, { zone: "tables" });
      const input = {
        submissionId: randomUUID(),
        expectedPartyRevision: await partyRevision(tx, venue.party.partyId),
        operatorId: OPERATOR,
        groups: [
          {
            lines: [
              { menuItemId: offers.offerFor(venue.products.burger), quantity: "1" },
              { menuItemId: offers.offerFor(salad), quantity: "1" },
            ],
            release: "fire" as const,
          },
        ],
      };
      const first = await submitGroups(tx, venue.cfg, venue.party.partyId, input);
      const rowsAfterFirst = await items(tx, venue.party.tabId);
      const jobsAfterFirst = await jobCounts(tx, venue);
      expect(rowsAfterFirst).toHaveLength(2);
      expect(rowsAfterFirst.filter((row) => row.passControlled)).toHaveLength(1);
      expect(jobsAfterFirst).toMatchObject({ grill: 0, pass: 0, kitchen: 1 });
      const second = await submitGroups(tx, venue.cfg, venue.party.partyId, input);
      expect(second).toEqual(first);
      expect(await items(tx, venue.party.tabId)).toEqual(rowsAfterFirst);
      expect(await jobCounts(tx, venue)).toEqual(jobsAfterFirst);
    });
  });

  it("a legacy recall puts a released item back to held, both stamps cleared", async () => {
    const venue = await setupSplitExtrasVenue();
    await withTransaction(db, async (tx) => {
      await addTabRound(tx, venue.cfg, venue.party.tabId, [burgerLine(venue)]);
      const [released] = await items(tx, venue.party.tabId);
      expect(released).toEqual({
        ...released,
        requestedAt: released!.firedAt,
        firedAt: expect.any(String),
        passControlled: false,
      });
      const [line] = await tx
        .select({ lineNo: workingOrderLines.lineNo })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.id, released!.lineId));
      await recallLines(tx, venue.cfg, venue.party.tabId, [line!.lineNo]);
      const [recalled] = await items(tx, venue.party.tabId);
      expect(recalled).toEqual({
        ...released,
        requestedAt: null,
        firedAt: null,
        passControlled: false,
      });
      expect(kitchenPhase(recalled!)).toBe("held");
    });
  });
});
