import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deviceProfiles, kitchenStations, ticketItems } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { hashSessionToken, persons, sessions } from "@waitron/identity";
import { decimal } from "@waitron/shared";
import type { DeviceKitchenScreen, KitchenAllergyBlock } from "@waitron/module";
import { ALLERGEN_NAMES } from "./i18n/kitchen-allergy.js";
import { mountTillApi } from "./till-api.js";
import { mountDeviceApi } from "./device-api.js";
import { createPairingMode } from "./pairing-mode.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { SESSION_COOKIE } from "./till-session.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { OPERATOR, inTx, seat, setupPartyVenue } from "./testing/party-venue.js";
import { readBillEditState } from "./bill-editing.js";
import { submitGroups } from "./order-groups.js";
import { VENUE_SERVICE } from "./modules.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const original: KitchenAllergyBlock = {
  who: "Window guest",
  allergens: { milk: {} },
  note: "Separate pan",
  clashes: {},
  labels: {
    en: { avoids: ["Milk"], clashes: [] },
    es: { avoids: [ALLERGEN_NAMES.milk.es], clashes: [] },
  },
};
const changed: KitchenAllergyBlock = {
  ...original,
  who: "Guest corrected",
  note: "Separate tools",
};

async function fixture() {
  const v = await setupPartyVenue(suite.db);
  await v.db.insert(persons).values({ id: OPERATOR, displayName: "Test operator", role: "staff" });
  const token = randomUUID();
  await v.db
    .update(sessions)
    .set({ tokenHash: hashSessionToken(token) })
    .where(eq(sessions.id, v.operator.sessionId));
  const party = await seat(v, await v.table("Kitchen HTTP"));
  await inTx(v, async (tx) =>
    submitGroups(tx, v.cfg, party.partyId, {
      submissionId: randomUUID(),
      expectedPartyRevision: party.revision,
      operatorId: OPERATOR,
      expectedEdit: await readBillEditState(tx, party.tabId),
      groups: [{ release: "fire", lines: [{ menuItemId: v.item("Burger"), quantity: "1" }] }],
      allergy: {
        party: {
          answer: "allergies",
          guests: [{ who: original.who, allergens: original.allergens, note: original.note }],
        },
        ticks: [{ line: { kind: "submitted", groupIndex: 0, lineIndex: 0 }, guestIndex: 0 }],
      },
    }),
  );
  const [ticket] = await v.db
    .select()
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderId, party.tabId));
  const [station] = await v.db
    .select()
    .from(kitchenStations)
    .where(eq(kitchenStations.id, ticket!.stationId));
  const [profile] = await v.db
    .insert(deviceProfiles)
    .values({ name: "Kitchen display", formFactor: "kds", capabilities: [] })
    .returning();
  const enrol = async (kind: DeviceKitchenScreen["kind"]) => {
    const device = await enrolDeviceForTest(v.db, v.cfg, {
      name: `${kind} screen`,
      profileId: profile!.id,
      kitchenScreen: { kind, stationIds: null, zoneIds: null },
    });
    return `${DEVICE_COOKIE}=${device.deviceId}.${device.token}`;
  };
  const cookies = {
    station: await enrol("station"),
    pass: await enrol("pass"),
    monitor: await enrol("pass_monitor"),
  };
  const app = new Hono();
  mountTillApi(
    app,
    {
      db: v.db,
      cfg: v.cfg,
      backend: v.backend,
      clock: v.clock,
      venueLocale: "en-GB",
      secureCookies: false,
    },
    () => {},
  );
  mountDeviceApi(
    app,
    { db: v.db, cfg: v.cfg, secureCookies: false, pairingMode: createPairingMode() },
    () => {},
  );
  return {
    v,
    party,
    ticket: ticket!,
    station: station!,
    app,
    cookies,
    sessionCookie: `${SESSION_COOKIE}=${token}`,
  };
}

describe("A669 reads HTTP", () => {
  it("carries the original through signed-in station/expo and all device boards", async () => {
    const f = await fixture();
    await inTx(f.v, (tx) => VENUE_SERVICE.setTicketAllergyCurrent(tx, f.ticket.id, changed));
    const read = async (path: string, cookie: string) => {
      const response = await f.app.request(path, { headers: { cookie } });
      expect(response.status).toBe(200);
      return response.json();
    };
    const queue = await read(`/api/stations/${f.station.id}/queue`, f.sessionCookie);
    expect(queue.items[0].items[0].allergy).toEqual(original);
    const expo = await read("/api/expo/queue", f.sessionCookie);
    expect(expo[0].groups[0].items[0].allergy).toEqual(original);
    const station = await read("/api/device/station-screen", f.cookies.station);
    expect(
      station.stations.find((s: { id: string }) => s.id === f.station.id).queue[0].items[0].allergy,
    ).toEqual(original);
    for (const [path, cookie] of [
      ["/api/device/pass-screen", f.cookies.pass],
      ["/api/device/pass-monitor", f.cookies.monitor],
    ]) {
      const board = await read(path!, cookie!);
      expect(board.orders[0].groups[0].items[0].allergy).toEqual(original);
    }
  });

  it("keeps correction payloads separate from the original and existing order-note notices", async () => {
    const f = await fixture();
    await inTx(f.v, async (tx) => {
      const items = [
        {
          workingOrderLineId: f.ticket.workingOrderLineId,
          stationId: f.station.id,
          quantity: decimal("1"),
          wasStarted: false,
        },
      ];
      await VENUE_SERVICE.recordKitchenNotices(
        tx,
        f.v.cfg,
        f.party.tabId,
        items,
        "allergy_changed",
        { allergyBlock: changed },
      );
      await VENUE_SERVICE.recordKitchenNotices(
        tx,
        f.v.cfg,
        f.party.tabId,
        items,
        "allergy_removed",
        { allergyBlock: null },
      );
      await VENUE_SERVICE.recordKitchenNotices(tx, f.v.cfg, f.party.tabId, items, "changed", {
        orderNoteChange: { before: null, after: "Whole order note" },
      });
    });
    const response = await f.app.request(`/api/stations/${f.station.id}/queue`, {
      headers: { cookie: f.sessionCookie },
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.items[0].items[0].allergy).toEqual(original);
    expect(
      result.notices.map(
        (notice: {
          kind: string;
          allergyBlock?: KitchenAllergyBlock | null;
          orderNoteChange?: unknown;
        }) => ({
          kind: notice.kind,
          allergyBlock: notice.allergyBlock,
          orderNoteChange: notice.orderNoteChange,
        }),
      ),
    ).toEqual([
      { kind: "allergy_changed", allergyBlock: changed, orderNoteChange: undefined },
      { kind: "allergy_removed", allergyBlock: null, orderNoteChange: undefined },
      {
        kind: "changed",
        allergyBlock: undefined,
        orderNoteChange: { before: null, after: "Whole order note" },
      },
    ]);
  });
});
