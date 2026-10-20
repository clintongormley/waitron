import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  kitchenStations,
  printers,
  parties,
  printJobs,
  ticketItems,
  workingOrderLines,
  workingOrders,
  products,
  lineServiceCancellations,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { hashSessionToken, persons, sessions } from "@waitron/identity";
import { createPrinter } from "@waitron/printing";
import {
  createExtraList,
  createProduct,
  readContentLanguages,
  writeProductModifiers,
  updateProduct,
} from "@waitron/catalogue";
import { writePrintHeldWork } from "@waitron/venue-service";
import type { AllergyGuestInput, AllergyPatch, KitchenAllergyBlock } from "@waitron/module";
import { locationId as brandLocationId } from "@waitron/shared";
import { enqueueKitchenAllergyChanges } from "./kitchen-allergy.js";
import { applyPartyAllergyPatch, allergyTargets, readPartyAllergyView } from "./party-allergy.js";
import { mountTillApi } from "./till-api.js";
import { SESSION_COOKIE } from "./till-session.js";
import { readBillEditState } from "./bill-editing.js";
import { createStation } from "./kitchen.js";
import { routeProductTo } from "./testing/zone-offers.js";
import { republishMenus } from "./testing/publish-menu.js";
import { joinTables } from "./testing/table-action-fixture.js";
import { recallToDraft } from "./draft-recall.js";
import { submitGroups } from "./order-groups.js";
import { VENUE_SERVICE } from "./modules.js";
import {
  OPERATOR,
  inTx,
  commandFor,
  revisionOf,
  counterOrder,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";
import { attachPrinterToStation } from "./station-printers.js";
import { saveDraftForTest } from "./testing/draft-command-fixture.js";
import { printedLines } from "./testing/decode-ticket.js";
import { KITCHEN_ALLERGY_WORDS, ALLERGEN_NAMES } from "./i18n/kitchen-allergy.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let v: PartyVenue;
let app: Hono;
let cookie: string;
let stationId: string;
const guest: AllergyGuestInput = {
  who: "Window guest",
  allergens: { milk: {} },
  note: "Separate pan",
};
const original: KitchenAllergyBlock = {
  ...guest,
  clashes: { milk: {} },
  labels: {
    en: { avoids: ["Milk"], clashes: ["Milk"] },
    es: { avoids: [ALLERGEN_NAMES.milk.es], clashes: [ALLERGEN_NAMES.milk.es] },
  },
};
beforeEach(async () => {
  v = await setupPartyVenue(suite.db);
  await v.db.insert(persons).values({ id: OPERATOR, displayName: "Test operator", role: "staff" });
  const token = randomUUID();
  await v.db
    .update(sessions)
    .set({ tokenHash: hashSessionToken(token) })
    .where(eq(sessions.id, v.operator.sessionId));
  cookie = `${SESSION_COOKIE}=${token}`;
  const [station] = await v.db
    .select()
    .from(kitchenStations)
    .where(
      and(eq(kitchenStations.locationId, v.cfg.locationId), eq(kitchenStations.isDefault, true)),
    );
  stationId = station!.id;
  await inTx(v, (tx) => updateProduct(tx, v.productId("Burger"), { allergens: { milk: {} } }));
  app = new Hono();
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
});
async function printer() {
  return inTx(v, async (tx) => {
    const p = await createPrinter(tx, v.cfg, {
      name: "Allergy printer",
      transport: "cloud_poll",
      pollId: randomUUID(),
    });
    await attachPrinterToStation(tx, { locationId: v.cfg.locationId, stationId, printerId: p.id });
    return p;
  });
}
async function sent(
  release: "fire" | "hold" = "fire",
  assigned = true,
  extras?: { listId: string; picks: { productId: string; quantity: number }[] }[],
) {
  const tableId = await v.table(`Notice ${randomUUID().slice(0, 8)}`);
  const p = await seat(v, tableId);
  await inTx(v, async (tx) =>
    submitGroups(tx, v.cfg, p.partyId, {
      submissionId: randomUUID(),
      expectedPartyRevision: p.revision,
      operatorId: OPERATOR,
      expectedEdit: await readBillEditState(tx, p.tabId),
      groups: [
        {
          release,
          lines: [
            {
              menuItemId: v.item("Burger"),
              quantity: "3",
              note: "Dish note",
              ...(extras === undefined ? {} : { extras }),
            },
          ],
        },
      ],
      allergy: {
        party: { answer: "allergies", guests: [guest] },
        ticks: [
          {
            line: { kind: "submitted", groupIndex: 0, lineIndex: 0 },
            guestIndex: assigned ? 0 : null,
          },
        ],
      },
    }),
  );
  const [ticket] = await v.db
    .select()
    .from(ticketItems)
    .where(eq(ticketItems.workingOrderId, p.tabId));
  const snap = await inTx(v, (tx) => VENUE_SERVICE.readPartyAllergy(tx, p.partyId));
  return { ...p, tableId, ticket: ticket!, guest: snap.guests[0]! };
}
type Sent = Awaited<ReturnType<typeof sent>>;
async function request(path: string, body: unknown, method = "POST") {
  const response = await app.request(path, {
    method,
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const answer: unknown = await response.json();
  expect(response.status, JSON.stringify(answer)).toBe(200);
  return answer;
}
async function edit(p: Sent, allergy: AllergyPatch) {
  return request(
    `/api/parties/${p.partyId}/allergy`,
    { submissionId: randomUUID(), expectedPartyRevision: await revisionOf(v, p.partyId), allergy },
    "PUT",
  );
}
async function notices() {
  return inTx(v, (tx) => VENUE_SERVICE.listStationNotices(tx, v.cfg, stationId));
}
function patch(p: Sent, overrides: Partial<AllergyGuestInput> = {}): AllergyPatch {
  return { party: { answer: "allergies", guests: [{ ...p.guest, ...overrides }] }, ticks: [] };
}
async function copies(p: Sent) {
  return (await inTx(v, (tx) => VENUE_SERVICE.readTicketAllergies(tx, [p.ticket.id]))).get(
    p.ticket.id,
  );
}

describe("A669 notices", () => {
  it.each(["queued", "preparing", "ready"] as const)(
    "guest edits notify %s work without replacing its original",
    async (state) => {
      const p = await sent();
      await v.db
        .update(ticketItems)
        .set({ state, awayAt: new Date().toISOString() })
        .where(eq(ticketItems.id, p.ticket.id));
      await edit(p, patch(p, { who: "Corrected guest", note: "Separate tools" }));
      const block = { ...original, who: "Corrected guest", note: "Separate tools" };
      expect(
        (await notices()).map(
          ({ stationId: at, workingOrderId, kind, quantity, wasStarted, allergyBlock }) => ({
            at,
            workingOrderId,
            kind,
            quantity,
            wasStarted,
            allergyBlock,
          }),
        ),
      ).toEqual([
        {
          at: stationId,
          workingOrderId: p.tabId,
          kind: "allergy_changed",
          quantity: "3.000",
          wasStarted: state !== "queued",
          allergyBlock: block,
        },
      ]);
      expect(await copies(p)).toEqual({ originalBlock: original, currentBlock: block });
    },
  );
  it.each(["untick", "delete", "none"] as const)(
    "%s delivers a removal using the deleted assignment",
    async (mode) => {
      const p = await sent();
      const allergy: AllergyPatch =
        mode === "untick"
          ? {
              ticks: [
                { line: { kind: "working", id: p.ticket.workingOrderLineId }, guestIndex: null },
              ],
            }
          : { party: { answer: mode === "none" ? "none" : "allergies", guests: [] }, ticks: [] };
      await edit(p, allergy);
      expect(
        (await notices()).map(({ kind, allergyBlock, quantity }) => ({
          kind,
          allergyBlock,
          quantity,
        })),
      ).toEqual([{ kind: "allergy_removed", allergyBlock: null, quantity: "3.000" }]);
      expect(await copies(p)).toEqual({ originalBlock: original, currentBlock: null });
    },
  );
  it("reticking a frozen unticked item sends the new block", async () => {
    const p = await sent("fire", false);
    await edit(p, {
      ticks: [{ line: { kind: "working", id: p.ticket.workingOrderLineId }, guestIndex: 0 }],
    });
    expect((await notices()).map(({ kind, allergyBlock }) => ({ kind, allergyBlock }))).toEqual([
      { kind: "allergy_changed", allergyBlock: original },
    ]);
    expect(await copies(p)).toEqual({ originalBlock: null, currentBlock: original });
  });
  it("identical presentation with a replacement guest id sends no correction", async () => {
    const p = await sent();
    await edit(p, {
      party: { answer: "allergies", guests: [guest] },
      ticks: [{ line: { kind: "working", id: p.ticket.workingOrderLineId }, guestIndex: 0 }],
    });
    expect(await notices()).toEqual([]);
    expect(await copies(p)).toEqual({ originalBlock: original, currentBlock: original });
  });
  it("corrects only remaining service quantity after serving and cancellation", async () => {
    const p = await sent();
    await v.db
      .update(workingOrderLines)
      .set({ servedQuantity: 1000 })
      .where(eq(workingOrderLines.id, p.ticket.workingOrderLineId));
    await v.db.insert(lineServiceCancellations).values({
      lineId: p.ticket.workingOrderLineId,
      quantity: 1000,
      actorId: OPERATOR,
      wasStarted: false,
      cancelledAt: new Date().toISOString(),
    });
    await edit(p, patch(p, { note: "Fresh tools" }));
    expect((await notices()).map(({ quantity }) => quantity)).toEqual(["1.000"]);
  });
  it.each(["served", "cancelled", "collected", "closed", "made-here", "unprinted-hold"] as const)(
    "%s work produces no correction",
    async (kind) => {
      const p = await sent(kind === "unprinted-hold" ? "hold" : "fire");
      if (kind === "served")
        await v.db
          .update(workingOrderLines)
          .set({ servedQuantity: 3000 })
          .where(eq(workingOrderLines.id, p.ticket.workingOrderLineId));
      if (kind === "cancelled")
        await v.db.insert(lineServiceCancellations).values({
          lineId: p.ticket.workingOrderLineId,
          quantity: 3000,
          actorId: OPERATOR,
          wasStarted: false,
          cancelledAt: new Date().toISOString(),
        });
      if (kind === "collected")
        await v.db
          .update(workingOrders)
          .set({ collectedAt: new Date().toISOString() })
          .where(eq(workingOrders.id, p.tabId));
      if (kind === "closed")
        await v.db
          .update(parties)
          .set({ state: "closed", closedAt: new Date().toISOString(), closedBy: OPERATOR })
          .where(eq(parties.id, p.partyId));
      if (kind === "made-here")
        await v.db
          .update(ticketItems)
          .set({ madeHere: true })
          .where(eq(ticketItems.id, p.ticket.id));
      if (kind === "closed") {
        const response = await app.request(`/api/parties/${p.partyId}/allergy`, {
          method: "PUT",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({
            submissionId: randomUUID(),
            expectedPartyRevision: await revisionOf(v, p.partyId),
            allergy: patch(p, { note: "Fresh tools" }),
          }),
        });
        expect(await response.json()).toMatchObject({ error: { code: "party.not_open" } });
        expect(await notices()).toEqual([]);
        return;
      }
      await edit(p, patch(p, { note: "Fresh tools" }));
      expect(await notices()).toEqual([]);
    },
  );
  it("a queued HOLD copy notifies even after its printer is removed", async () => {
    const device = await printer();
    await inTx(v, (tx) => writePrintHeldWork(tx, true));
    const p = await sent("hold");
    await v.db.update(printers).set({ active: false }).where(eq(printers.id, device.id));
    await edit(p, patch(p, { note: "Fresh tools" }));
    expect((await notices()).map(({ kind, quantity }) => ({ kind, quantity }))).toEqual([
      { kind: "allergy_changed", quantity: "3.000" },
    ]);
  });
  it.each(["fire", "hold"] as const)(
    "%s routes allergy corrections to exactly the exposed dish/extra stations",
    async (release) => {
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
            maxPicks: 2,
            active: true,
            items: [{ productId: side.id, maxQuantity: 2, preselected: false, price: "1.00" }],
          },
          v.cfg.locale,
        );
        await writeProductModifiers(tx, v.productId("Burger"), [{ kind: "extras", id: list.id }]);
        const station = await createStation(tx, v.cfg, { name: "Sides kitchen" });
        await routeProductTo(tx, v.cfg, side.id, station.id);
        await republishMenus(tx);
        return { side, list, station };
      });
      await printer();
      if (release === "hold") await inTx(v, (tx) => writePrintHeldWork(tx, true));
      const p = await sent(release, true, [
        { listId: extra.list.id, picks: [{ productId: extra.side.id, quantity: 2 }] },
      ]);
      const tickets = await v.db
        .select()
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, p.tabId));
      expect(tickets).toHaveLength(2);
      const side = tickets.find((item) => item.stationId === extra.station.id)!;
      expect(side).toBeDefined();
      if (release === "fire") {
        await v.db
          .update(workingOrderLines)
          .set({ servedQuantity: 1000 })
          .where(eq(workingOrderLines.id, p.ticket.workingOrderLineId));
        await v.db
          .update(workingOrderLines)
          .set({ servedQuantity: 2000 })
          .where(eq(workingOrderLines.id, side.workingOrderLineId));
        await v.db.insert(lineServiceCancellations).values({
          lineId: p.ticket.workingOrderLineId,
          quantity: 1000,
          actorId: OPERATOR,
          wasStarted: false,
          cancelledAt: new Date().toISOString(),
        });
      }
      await edit(p, patch(p, { note: "Fresh tools" }));
      const byStation = await inTx(v, (tx) =>
        VENUE_SERVICE.listStationsNotices(tx, v.cfg, [stationId, extra.station.id]),
      );
      expect(
        byStation.get(stationId)!.map(({ quantity, allergyBlock }) => ({ quantity, allergyBlock })),
      ).toEqual([
        {
          quantity: release === "hold" ? "3.000" : "1.000",
          allergyBlock: { ...original, note: "Fresh tools" },
        },
      ]);
      expect(
        byStation
          .get(extra.station.id)!
          .map(({ quantity, allergyBlock }) => ({ quantity, allergyBlock })),
      ).toEqual(
        release === "hold"
          ? []
          : [{ quantity: "2.000", allergyBlock: { ...original, note: "Fresh tools" } }],
      );
      const jobs = await v.db.select().from(printJobs);
      expect(jobs).toHaveLength(2);
    },
  );
  it("a recalled source receives no allergy correction or printer job", async () => {
    await printer();
    const p = await sent();
    const revision = await revisionOf(v, p.partyId);
    await inTx(v, async (tx) =>
      recallToDraft(tx, v.cfg, p.partyId, p.ticket.workingOrderLineId, {
        submissionId: randomUUID(),
        expectedPartyRevision: revision,
        operatorId: OPERATOR,
        expectedEdit: await readBillEditState(tx, p.tabId),
      }),
    );
    const jobs = await v.db.select().from(printJobs);
    await edit(p, patch(p, { note: "Fresh tools" }));
    expect((await notices()).filter((row) => row.kind.startsWith("allergy_"))).toEqual([]);
    expect(await v.db.select().from(printJobs)).toEqual(jobs);
  });
  it("deleting one guest corrects only that guest's dish", async () => {
    const p = await sent();
    const revision = await revisionOf(v, p.partyId);
    await inTx(v, async (tx) =>
      submitGroups(tx, v.cfg, p.partyId, {
        submissionId: randomUUID(),
        expectedPartyRevision: revision,
        operatorId: OPERATOR,
        expectedEdit: await readBillEditState(tx, p.tabId),
        groups: [
          {
            release: "fire",
            lines: [{ menuItemId: v.item("Burger"), quantity: "1", note: "Second guest's dish" }],
          },
        ],
        allergy: {
          party: {
            answer: "allergies",
            guests: [p.guest, { who: "Door guest", allergens: { eggs: {} }, note: "Other tools" }],
          },
          ticks: [{ line: { kind: "submitted", groupIndex: 0, lineIndex: 0 }, guestIndex: 1 }],
        },
      }),
    );
    const snapshot = await inTx(v, (tx) => VENUE_SERVICE.readPartyAllergy(tx, p.partyId));
    await edit(p, { party: { answer: "allergies", guests: [snapshot.guests[1]!] }, ticks: [] });
    expect(
      (await notices()).map(({ kind, quantity, allergyBlock }) => ({
        kind,
        quantity,
        allergyBlock,
      })),
    ).toEqual([{ kind: "allergy_removed", quantity: "3.000", allergyBlock: null }]);
  });
  it("reordered kinds with the same presentation do not create another correction", async () => {
    const p = await sent();
    await edit(p, patch(p, { allergens: { gluten: { kinds: ["wheat", "rye"] }, milk: {} } }));
    const before = await notices();
    expect(before).toHaveLength(1);
    await edit(p, patch(p, { allergens: { milk: {}, gluten: { kinds: ["rye", "wheat"] } } }));
    expect(await notices()).toEqual(before);
  });
  it("batches print metadata for all corrections of one order", async () => {
    await printer();
    const p = await sent();
    const revision = await revisionOf(v, p.partyId);
    await inTx(v, async (tx) =>
      submitGroups(tx, v.cfg, p.partyId, {
        submissionId: randomUUID(),
        expectedPartyRevision: revision,
        operatorId: OPERATOR,
        expectedEdit: await readBillEditState(tx, p.tabId),
        groups: [
          {
            release: "fire",
            lines: [{ menuItemId: v.item("Burger"), quantity: "1", note: "Other dish" }],
          },
        ],
        allergy: {
          ticks: [{ line: { kind: "submitted", groupIndex: 0, lineIndex: 0 }, guestIndex: 0 }],
        },
      }),
    );
    const read = vi.spyOn(VENUE_SERVICE, "readTicketAllergies");
    try {
      await edit(p, patch(p, { note: "Fresh tools" }));
      expect(
        (await notices())
          .map(({ quantity, allergyBlock }) => ({ quantity, allergyBlock }))
          .sort((a, b) => b.quantity.localeCompare(a.quantity)),
      ).toEqual([
        { quantity: "3.000", allergyBlock: { ...original, note: "Fresh tools" } },
        { quantity: "1.000", allergyBlock: { ...original, note: "Fresh tools" } },
      ]);
      expect(read).toHaveBeenCalledTimes(2);
    } finally {
      read.mockRestore();
    }
  });
  it("a paid bill retained by a merged party follows the surviving party's correction", async () => {
    const p = await sent();
    await v.db
      .update(workingOrders)
      .set({ status: "settled", settledAt: new Date().toISOString() })
      .where(eq(workingOrders.id, p.tabId));
    const into = await seat(v, await v.table("Surviving party"));
    const command = await commandFor(v, into.partyId);
    const oldRevision = await revisionOf(v, p.partyId);
    await inTx(v, (tx) =>
      joinTables(tx, v.cfg, into.partyId, p.tableId, {
        ...command,
        bills: "separate",
        otherPartyId: p.partyId,
        expectedOtherPartyRevision: oldRevision,
      }),
    );
    const [bill] = await v.db.select().from(workingOrders).where(eq(workingOrders.id, p.tabId));
    expect(bill!.partyId).toBe(p.partyId);
    await edit({ ...p, partyId: into.partyId }, patch(p, { note: "Fresh tools" }));
    expect(
      (await notices())
        .filter((row) => row.kind.startsWith("allergy_"))
        .map(({ kind, allergyBlock, quantity }) => ({ kind, allergyBlock, quantity })),
    ).toEqual([
      {
        kind: "allergy_changed",
        allergyBlock: { ...original, note: "Fresh tools" },
        quantity: "3.000",
      },
    ]);
    expect(await copies(p)).toEqual({
      originalBlock: original,
      currentBlock: { ...original, note: "Fresh tools" },
    });
  });
  it("another location cannot update the copy or receive its correction", async () => {
    const p = await sent();
    const copy = await copies(p);
    await inTx(v, async (tx) => {
      const view = await readPartyAllergyView(tx, v.cfg, p.partyId);
      const changes = await applyPartyAllergyPatch(
        tx,
        p.partyId,
        patch(p, { note: "Fresh tools" }),
        OPERATOR,
        allergyTargets(view),
      );
      await enqueueKitchenAllergyChanges(
        tx,
        { ...v.cfg, locationId: brandLocationId(randomUUID()) },
        changes,
      );
    });
    expect(await copies(p)).toEqual(copy);
    expect(await notices()).toEqual([]);
  });
  it.each(["groups", "draft", "release", "move"] as const)(
    "%s HTTP caller corrects an older dish before its new output",
    async (path) => {
      const p = await sent();
      const allergy = patch(p, { note: "Fresh tools" });
      let url: string;
      let body: Record<string, unknown>;
      if (path === "move") {
        const billId = await counterOrder(v, "Burger");
        url = `/api/bills/${billId}/move`;
        body = {
          submissionId: randomUUID(),
          partyId: null,
          otherPartyId: p.partyId,
          expectedOtherPartyRevision: await revisionOf(v, p.partyId),
          bills: "separate",
          to: { tableId: p.tableId },
          allergy,
          expectedEdits: await inTx(v, async (tx) =>
            [await readBillEditState(tx, billId), await readBillEditState(tx, p.tabId)].sort(
              (a, b) => a.billId.localeCompare(b.billId),
            ),
          ),
        };
      } else if (path === "draft") {
        const d = await inTx(v, (tx) =>
          saveDraftForTest(tx, v.cfg, p.partyId, OPERATOR, {
            billId: p.tabId,
            draftId: null,
            revision: 0,
            lines: [
              {
                sourceLineId: null,
                menuItemId: v.item("Burger"),
                variantId: null,
                menuVersionId: null,
                options: [],
                extras: [],
                note: "New draft",
                quantity: "1",
                courseId: null,
                noMerge: true,
                slot: 0,
                joinGroupId: null,
                afterGroupId: null,
              },
            ],
          }),
        );
        url = `/api/parties/${p.partyId}/drafts/${d.id}/submit`;
        body = {
          submissionId: randomUUID(),
          expectedPartyRevision: await revisionOf(v, p.partyId),
          draftRevision: d.revision,
          expectedEdit: await inTx(v, (tx) => readBillEditState(tx, p.tabId)),
          groups: [{ release: "fire", lineIds: d.lines.map((line) => line.id) }],
          allergy,
        };
      } else if (path === "release") {
        const revision = await revisionOf(v, p.partyId);
        const group = await inTx(v, async (tx) =>
          submitGroups(tx, v.cfg, p.partyId, {
            submissionId: randomUUID(),
            expectedPartyRevision: revision,
            operatorId: OPERATOR,
            expectedEdit: await readBillEditState(tx, p.tabId),
            groups: [
              {
                release: "hold",
                lines: [{ menuItemId: v.item("Burger"), quantity: "1", note: "New held dish" }],
              },
            ],
          }),
        );
        url = `/api/parties/${p.partyId}/groups/${group.groups[0]!.id}/fire`;
        body = {
          submissionId: randomUUID(),
          expectedPartyRevision: await revisionOf(v, p.partyId),
          allergy,
        };
      } else {
        url = `/api/parties/${p.partyId}/groups`;
        body = {
          submissionId: randomUUID(),
          expectedPartyRevision: await revisionOf(v, p.partyId),
          expectedEdit: await inTx(v, (tx) => readBillEditState(tx, p.tabId)),
          groups: [
            {
              release: "fire",
              lines: [{ menuItemId: v.item("Burger"), quantity: "1", note: "New dish" }],
            },
          ],
          allergy,
        };
      }
      await request(url, body);
      expect(
        (await notices())
          .filter((row) => row.kind.startsWith("allergy_"))
          .map(({ workingOrderId, quantity, allergyBlock }) => ({
            workingOrderId,
            quantity,
            allergyBlock,
          })),
      ).toEqual([
        {
          workingOrderId: p.tabId,
          quantity: "3.000",
          allergyBlock: { ...original, note: "Fresh tools" },
        },
      ]);
      expect(await copies(p)).toEqual({
        originalBlock: original,
        currentBlock: { ...original, note: "Fresh tools" },
      });
    },
  );
  it("queues a changed slip and a removal slip without changing old job bytes", async () => {
    await printer();
    const p = await sent();
    const before = await v.db.select().from(printJobs);
    await edit(p, patch(p, { who: "Corrected guest" }));
    await edit(p, { party: { answer: "none", guests: [] }, ticks: [] });
    const after = await v.db.select().from(printJobs);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after).toHaveLength(before.length + 2);
    const text = after.slice(before.length).map((job) => printedLines(job.payload));
    expect(text[0]!.join("\n")).toContain(KITCHEN_ALLERGY_WORDS.es.changed);
    expect(text[0]!.join("\n")).toContain("Corrected guest");
    expect(text[1]!.join("\n")).toContain(KITCHEN_ALLERGY_WORDS.es.removed);
    expect(text[1]!.join("\n")).not.toContain("Window guest");
  });
});
