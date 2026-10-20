import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { kitchenStations, ticketItems, workingOrderLines, products } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  createExtraList,
  createProduct,
  readContentLanguages,
  updateProduct,
  writeProductModifiers,
} from "@waitron/catalogue";
import type { KitchenAllergyBlock } from "@waitron/module";
import { readBillEditState } from "./bill-editing.js";
import { submitGroups, type SubmitGroupsInput } from "./order-groups.js";
import { listExpoQueue, listStationQueue, listStationQueues } from "./working-order.js";
import { listPassMonitor, listPassScreen } from "./pass-board.js";
import { VENUE_SERVICE } from "./modules.js";
import { ALLERGEN_NAMES } from "./i18n/kitchen-allergy.js";
import {
  OPERATOR,
  inTx,
  revisionOf,
  seat,
  split,
  commandFor,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { createStation } from "./kitchen.js";
import { routeProductTo } from "./testing/zone-offers.js";
import { republishMenus } from "./testing/publish-menu.js";
import { mergeBills } from "./testing/bill-action-fixture.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let v: PartyVenue;
let stationId: string;
const original: KitchenAllergyBlock = {
  who: "Window guest",
  allergens: { milk: {} },
  note: "Separate pan",
  clashes: { milk: {} },
  labels: {
    en: { avoids: ["Milk"], clashes: ["Milk"] },
    es: { avoids: [ALLERGEN_NAMES.milk.es], clashes: [ALLERGEN_NAMES.milk.es] },
  },
};
const current: KitchenAllergyBlock = {
  who: "New guest name",
  allergens: { eggs: {} },
  note: "Different pan",
  clashes: {},
  labels: {
    en: { avoids: ["Eggs"], clashes: [] },
    es: { avoids: [ALLERGEN_NAMES.eggs.es], clashes: [] },
  },
};
beforeEach(async () => {
  v = await setupPartyVenue(suite.db);
  const [station] = await v.db
    .select()
    .from(kitchenStations)
    .where(eq(kitchenStations.locationId, v.cfg.locationId));
  stationId = station!.id;
  await inTx(v, (tx) => updateProduct(tx, v.productId("Burger"), { allergens: { milk: {} } }));
});

async function sent(
  release: "fire" | "hold" = "fire",
  assigned = true,
  extras?: NonNullable<SubmitGroupsInput["groups"][number]["lines"][number]["extras"]>,
) {
  const party = await seat(v, await v.table(`Read ${randomUUID().slice(0, 8)}`));
  const revision = await revisionOf(v, party.partyId);
  await inTx(v, async (tx) =>
    submitGroups(tx, v.cfg, party.partyId, {
      submissionId: randomUUID(),
      expectedPartyRevision: revision,
      operatorId: OPERATOR,
      expectedEdit: await readBillEditState(tx, party.tabId),
      groups: [
        {
          release,
          lines: [
            {
              menuItemId: v.item("Burger"),
              quantity: "1",
              ...(extras === undefined ? {} : { extras }),
            },
            { menuItemId: v.item("Burger"), quantity: "2", note: "Unticked dish" },
          ],
        },
      ],
      allergy: {
        party: {
          answer: "allergies",
          guests: [{ who: original.who, allergens: original.allergens, note: original.note }],
        },
        ticks: [0, 1].map((lineIndex) => ({
          line: { kind: "submitted" as const, groupIndex: 0, lineIndex },
          guestIndex: assigned && lineIndex === 0 ? 0 : null,
        })),
      },
    }),
  );
  const tickets = await v.db
    .select()
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderId, party.tabId));
  expect(tickets).toHaveLength(extras === undefined ? 2 : 3);
  return { ...party, tickets };
}

function boardItems(board: Awaited<ReturnType<typeof listPassMonitor>>) {
  return board.orders.flatMap((order) =>
    [...order.groups, ...order.courses].flatMap((section) => section.items),
  );
}

describe("A669 reads", () => {
  it("keeps a routed extra's frozen copy at its own station and on every pass projection", async () => {
    const extra = await inTx(v, async (tx) => {
      const [parent] = await tx
        .select()
        .from(products)
        .where(eq(products.id, v.productId("Burger")));
      const { defaultLanguage } = await readContentLanguages(tx, v.cfg.locale);
      const side = await createProduct(tx, {
        catalogueId: parent!.catalogueId,
        categoryId: null,
        name: "Side staff",
        customerName: { [defaultLanguage]: "Side customer" },
        kitchenName: "SIDE COOK",
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "reduced",
        allergens: { milk: {} },
      });
      const list = await createExtraList(
        tx,
        {
          name: "Sides",
          customerName: null,
          kitchenName: null,
          minPicks: 0,
          maxPicks: 1,
          active: true,
          items: [{ productId: side.id, maxQuantity: 1, preselected: false, price: "1.00" }],
        },
        v.cfg.locale,
      );
      await writeProductModifiers(tx, v.productId("Burger"), [{ kind: "extras", id: list.id }]);
      const station = await createStation(tx, v.cfg, { name: "Side station" });
      await routeProductTo(tx, v.cfg, side.id, station.id);
      await republishMenus(tx);
      return { side, list, station };
    });
    const p = await sent("fire", true, [
      { listId: extra.list.id, picks: [{ productId: extra.side.id, quantity: 1 }] },
    ]);
    const sides = p.tickets.filter((ticket) => ticket.stationId === extra.station.id);
    expect(sides).toHaveLength(1);
    const station = await inTx(v, (tx) => listStationQueue(tx, extra.station.id));
    expect(station[0]!.items.map((item) => ({ id: item.id, allergy: item.allergy }))).toEqual([
      { id: sides[0]!.id, allergy: original },
    ]);
    for (const board of [
      await inTx(v, async (tx) => ({ orders: await listExpoQueue(tx, v.cfg) })),
      await inTx(v, (tx) =>
        listPassScreen(tx, v.cfg, randomUUID(), { stationIds: [extra.station.id], zoneIds: null }),
      ),
      await inTx(v, (tx) =>
        listPassMonitor(tx, v.cfg, { stationIds: [extra.station.id], zoneIds: null }),
      ),
    ]) {
      expect(
        boardItems(board)
          .filter((item) => item.id === sides[0]!.id)
          .map((item) => item.allergy),
      ).toEqual([original]);
    }
  });

  it("returns both original copies after whole-line bill splitting and merging", async () => {
    const p = await sent();
    const lines = await v.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, p.tabId));
    const other = await split(v, p.partyId, p.tabId, [lines[0]!.lineNo]);
    const command = await commandFor(v, p.partyId);
    await inTx(v, (tx) => mergeBills(tx, v.cfg, p.tabId, other, command));
    const items = (await inTx(v, (tx) => listStationQueue(tx, stationId))).flatMap(
      (order) => order.items,
    );
    expect(new Map(items.map((item) => [item.id, item.allergy]))).toEqual(
      new Map(p.tickets.map((ticket, n) => [ticket.id, n === 0 ? original : null])),
    );
    expect(
      new Map(
        boardItems({ orders: await inTx(v, (tx) => listExpoQueue(tx, v.cfg)) }).map((item) => [
          item.id,
          item.allergy,
        ]),
      ),
    ).toEqual(new Map(items.map((item) => [item.id, item.allergy])));
  });

  it("returns original copies and explicit null on single and batched station reads", async () => {
    const p = await sent();
    const empty = await inTx(v, (tx) => createStation(tx, v.cfg, { name: "Empty station" }));
    const single = await inTx(v, (tx) => listStationQueue(tx, stationId));
    const batch = await inTx(v, (tx) => listStationQueues(tx, [stationId, empty.id]));
    expect(batch.get(stationId)).toEqual(single);
    expect(batch.get(empty.id)).toEqual([]);
    expect(
      single
        .flatMap((order) => order.items)
        .map((item) => ({ id: item.id, allergy: Reflect.get(item, "allergy") })),
    ).toEqual(
      p.tickets.map((ticket, n) => ({ id: ticket.id, allergy: n === 0 ? original : null })),
    );
    expect(await inTx(v, (tx) => listStationQueues(tx, []))).toEqual(new Map());
  });

  it.each(["every", "pass", "monitor"] as const)(
    "returns the same copy on the %s board after corrections and live edits",
    async (mode) => {
      const p = await sent();
      await inTx(v, async (tx) => {
        await VENUE_SERVICE.setTicketAllergyCurrent(tx, p.tickets[0]!.id, current);
        await VENUE_SERVICE.writePartyAllergy(
          tx,
          p.partyId,
          { answer: "none", guests: [] },
          OPERATOR,
        );
        await updateProduct(tx, v.productId("Burger"), { allergens: { eggs: {} } });
      });
      const oldName = ALLERGEN_NAMES.milk.en;
      ALLERGEN_NAMES.milk.en = "Future dictionary label";
      try {
        const board = await inTx(v, async (tx) => {
          if (mode === "every") return { orders: await listExpoQueue(tx, v.cfg) };
          const scope = { stationIds: [stationId], zoneIds: null };
          return mode === "pass"
            ? listPassScreen(tx, v.cfg, randomUUID(), scope)
            : listPassMonitor(tx, v.cfg, scope);
        });
        const items = boardItems(board);
        expect(
          items.map((item) => ({ id: item.id, allergy: Reflect.get(item, "allergy") })),
        ).toEqual(
          p.tickets.map((ticket, n) => ({ id: ticket.id, allergy: n === 0 ? original : null })),
        );
        const station = await inTx(v, (tx) => listStationQueue(tx, stationId));
        expect(station[0]!.items.map((item) => Reflect.get(item, "allergy"))).toEqual([
          original,
          null,
        ]);
      } finally {
        ALLERGEN_NAMES.milk.en = oldName;
      }
    },
  );

  it("does not expose a block for held work with no HOLD paper", async () => {
    await sent("hold");
    const station = await inTx(v, (tx) => listStationQueue(tx, stationId));
    expect(station[0]!.items.map((item) => Reflect.get(item, "allergy"))).toEqual([null, null]);
  });

  it("keeps narrowed and empty scopes free of another station's allergy", async () => {
    await sent();
    const other = await inTx(v, async (tx) => {
      const station = await createStation(tx, v.cfg, { name: "Other cook" });
      await routeProductTo(tx, v.cfg, v.productId("Burger"), station.id);
      return station;
    });
    const p = await sent("fire", false);
    for (const mode of ["pass", "monitor"] as const) {
      const read = (ids: string[]) =>
        inTx(v, (tx) =>
          mode === "pass"
            ? listPassScreen(tx, v.cfg, randomUUID(), { stationIds: ids, zoneIds: null })
            : listPassMonitor(tx, v.cfg, { stationIds: ids, zoneIds: null }),
        );
      const items = boardItems(await read([other.id]));
      expect(items.map((item) => ({ id: item.id, allergy: Reflect.get(item, "allergy") }))).toEqual(
        p.tickets.map((ticket) => ({ id: ticket.id, allergy: null })),
      );
      expect(await read([])).toEqual({ orders: [] });
    }
  });

  it("reads copies once for a station batch and once for the whole pass board", async () => {
    const p = await sent();
    const read = vi.spyOn(VENUE_SERVICE, "readTicketAllergies");
    try {
      await inTx(v, (tx) => listStationQueues(tx, [stationId]));
      expect(read.mock.calls.map((call) => [...call[1]].sort())).toEqual([
        p.tickets.map((ticket) => ticket.id).sort(),
      ]);
      read.mockClear();
      await inTx(v, (tx) => listExpoQueue(tx, v.cfg));
      expect(read.mock.calls.map((call) => [...call[1]].sort())).toEqual([
        p.tickets.map((ticket) => ticket.id).sort(),
      ]);
    } finally {
      read.mockRestore();
    }
  });
});
