import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  orderDraftLines,
  orderGroups,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import type { AllergenMap } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { savePartyAllergy, setRoutingCell } from "@waitron/venue-service";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createExtraList,
  createProduct,
  setMenuVariants,
  setProductVariants,
  updateProduct,
  writeProductModifiers,
} from "@waitron/catalogue";
import type { AllergySendTarget } from "@waitron/module";
import {
  allergyTargets,
  applyPartyAllergyPatch,
  readAllergySendView,
  readPartyAllergyView,
} from "./party-allergy.js";
import { saveDraftForTest } from "./testing/draft-command-fixture.js";
import { placeGroups } from "./testing/group-submit-fixture.js";
import {
  OPERATOR,
  commandFor,
  inTx,
  revisionOf,
  seat,
  setupPartyVenue,
  split,
  type PartyVenue,
} from "./testing/party-venue.js";
import { VENUE_SERVICE } from "./modules.js";
import type { FreshDraftLineInput } from "./order-drafts.js";
import { readBillEditState } from "./bill-editing.js";
import { recallToDraft } from "./draft-recall.js";
import { createCourse } from "./kitchen.js";
import { offerProducts } from "./testing/zone-offers.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { joinTables } from "./testing/table-action-fixture.js";

let v: PartyVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});

async function party() {
  const tableId = await v.table(`Allergy ${randomUUID().slice(0, 8)}`);
  const seated = await seat(v, tableId);
  await inTx(v, (tx) =>
    VENUE_SERVICE.writePartyAllergy(tx, seated.partyId, { answer: "none", guests: [] }, OPERATOR),
  );
  return { ...seated, tableId };
}

function fresh(overrides: Partial<FreshDraftLineInput> = {}): FreshDraftLineInput {
  return {
    sourceLineId: null,
    menuItemId: v.item("Burger"),
    variantId: null,
    menuVersionId: null,
    options: [],
    extras: [],
    note: null,
    quantity: "1",
    courseId: null,
    noMerge: true,
    slot: 0,
    joinGroupId: null,
    afterGroupId: null,
    ...overrides,
  };
}

async function draft(p: { partyId: string; tabId: string }) {
  return inTx(v, (tx) =>
    saveDraftForTest(tx, v.cfg, p.partyId, OPERATOR, {
      billId: p.tabId,
      draftId: null,
      revision: 0,
      lines: [fresh()],
    }),
  );
}

async function held(p: { partyId: string; tabId: string }, count = 1) {
  await inTx(v, (tx) =>
    placeGroups(tx, v.cfg, p.partyId, {
      billId: p.tabId,
      operatorId: OPERATOR,
      groups: [
        {
          release: "hold",
          lines: Array.from({ length: count }, () => ({
            menuItemId: v.item("Burger"),
            quantity: "1",
          })),
        },
      ],
    }),
  );
  return v.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, p.tabId))
    .orderBy(workingOrderLines.lineNo);
}

function view(partyId: string, target?: AllergySendTarget) {
  return inTx(v, (tx) =>
    target === undefined
      ? readPartyAllergyView(tx, v.cfg, partyId)
      : readAllergySendView(tx, v.cfg, partyId, target),
  );
}

async function nutritionProducts() {
  return inTx(v, async (tx) => {
    const catalogue = await createCatalogue(tx, { name: `Nutrition ${randomUUID().slice(0, 8)}` });
    const category = await createCategory(tx, { name: `Dishes ${randomUUID().slice(0, 8)}` });
    const make = (name: string, allergens?: AllergenMap) =>
      createProduct(tx, {
        catalogueId: catalogue.id,
        categoryId: category.id,
        name: `${name} ${randomUUID().slice(0, 8)}`,
        customerName: { es: `${name} customer` },
        kitchenName: `${name} kitchen`,
        pricingUnit: "each",
        unitPrice: "2.00",
        vatClass: "general",
        ...(allergens === undefined ? {} : { allergens }),
      });
    const parent = await make("Pie", { milk: {} });
    const egg = await make("Egg sauce", { eggs: {} });
    const unknown = await make("Unknown sauce");
    const empty = await make("Reviewed sauce", {});
    const [variant] = await setProductVariants(
      tx,
      parent.id,
      [
        {
          name: "Large",
          customerName: { es: "Large customer" },
          kitchenName: "Large kitchen",
          image: null,
          unitPrice: "3.00",
          available: true,
        },
      ],
      "es-ES",
    );
    await updateProduct(tx, variant!.id, { allergens: { gluten: { kinds: ["wheat"] } } });
    const list = await createExtraList(
      tx,
      {
        name: `Sauces ${randomUUID().slice(0, 8)}`,
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: null,
        active: true,
        items: [egg, unknown, empty].map((p) => ({
          productId: p.id,
          maxQuantity: 1,
          preselected: false,
          price: "1.00",
        })),
      },
      "es-ES",
    );
    await writeProductModifiers(tx, parent.id, [{ kind: "extras", id: list.id }]);
    await assignCatalogueToLocation(tx, v.cfg.locationId, catalogue.id);
    const offers = await offerProducts(tx, v.cfg, {
      zone: { zoneId: v.tables.zoneId },
      orderStart: "table",
    });
    const menuItemId = offers.offerFor(parent.id);
    await setMenuVariants(tx, menuItemId, [{ variantId: variant!.id, price: "3.00" }]);
    await publishWorkingMenu(tx, offers.menuId);
    return { parent, egg, unknown, empty, variant: variant!, menuItemId, list, offers };
  });
}

describe("A669 candidate sets", () => {
  it("keeps draft and working references distinct when their tables use the same id", async () => {
    const p = await party();
    const [working] = await held(p);
    const d = await draft(p);
    await v.db
      .update(orderDraftLines)
      .set({ id: working!.id })
      .where(eq(orderDraftLines.id, d.lines[0]!.id));
    const result = await view(p.partyId, { kind: "draft", draftId: d.id, lineIds: [working!.id] });
    expect(result.dishes).toEqual([
      expect.objectContaining({ line: { kind: "draft", id: working!.id } }),
    ]);
  });

  it("keeps stored variant nutrition and extras separate and refuses an extras child as a dish", async () => {
    const p = await party();
    const n = await nutritionProducts();
    await inTx(v, (tx) =>
      placeGroups(tx, v.cfg, p.partyId, {
        billId: p.tabId,
        operatorId: OPERATOR,
        groups: [
          {
            release: "hold",
            lines: [
              {
                menuItemId: n.menuItemId,
                variantId: n.variant.id,
                quantity: "2",
                extras: [
                  {
                    listId: n.list.id,
                    picks: [n.egg, n.unknown, n.empty].map((product) => ({
                      productId: product.id,
                      quantity: 1,
                    })),
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    const stored = await v.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, p.tabId));
    const parent = stored.find((line) => line.parentLineId === null)!;
    const child = stored.find((line) => line.parentLineId !== null)!;
    const result = await view(p.partyId);
    expect(result.dishes).toEqual([
      {
        line: { kind: "working", id: parent.id },
        billId: p.tabId,
        name: `${n.parent.name} (Large)`,
        quantity: "2.000",
        allergens: { gluten: { kinds: ["wheat"] } },
        extras: [
          { name: n.egg.name, quantity: "2.000", allergens: { eggs: {} } },
          { name: n.unknown.name, quantity: "2.000", allergens: null },
          { name: n.empty.name, quantity: "2.000", allergens: {} },
        ],
        sentAt: null,
        offeredBefore: true,
      },
    ]);
    await expect(
      view(p.partyId, { kind: "lines", orderId: p.tabId, lineNos: [child.lineNo] }),
    ).rejects.toMatchObject({ code: "allergy.invalid" });
    await expect(view(p.partyId, { kind: "held-line", lineId: child.id })).rejects.toMatchObject({
      code: "group.not_found",
    });
  });

  it("reads every family bill and resolves a merged party id to its survivor", async () => {
    const a = await party(),
      b = await party();
    const [first] = await held(a);
    const [second] = await held(b);
    const command = await commandFor(v, a.partyId);
    const other = await revisionOf(v, b.partyId);
    await inTx(v, (tx) =>
      joinTables(tx, v.cfg, a.partyId, b.tableId, {
        ...command,
        bills: "separate",
        otherPartyId: b.partyId,
        expectedOtherPartyRevision: other,
      }),
    );
    const result = await view(b.partyId);
    expect(result.partyId).toBe(a.partyId);
    expect(result.dishes.map((d) => d.line)).toEqual(
      expect.arrayContaining([
        { kind: "working", id: first!.id },
        { kind: "working", id: second!.id },
      ]),
    );
    expect(result.dishes).toHaveLength(2);
  });

  it("reads and previews leave revisions, drafts and kitchen state unchanged", async () => {
    const p = await party();
    const [line] = await held(p);
    const d = await draft(p);
    const before = {
      view: await view(p.partyId),
      lines: await v.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, p.tabId)),
      groups: await v.db.select().from(orderGroups).where(eq(orderGroups.partyId, p.partyId)),
      tickets: await v.db.select().from(ticketItems).where(eq(ticketItems.workingOrderId, p.tabId)),
    };
    await view(p.partyId, { kind: "draft", draftId: d.id, lineIds: [d.lines[0]!.id] });
    await view(p.partyId, { kind: "group", groupId: line!.groupId! });
    expect({
      view: await view(p.partyId),
      lines: await v.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, p.tabId)),
      groups: await v.db.select().from(orderGroups).where(eq(orderGroups.partyId, p.partyId)),
      tickets: await v.db.select().from(ticketItems).where(eq(ticketItems.workingOrderId, p.tabId)),
    }).toEqual(before);
  });

  it("refuses unknown draft lines instead of silently accepting a subset", async () => {
    const p = await party();
    const d = await draft(p);
    await expect(
      view(p.partyId, { kind: "draft", draftId: d.id, lineIds: [d.lines[0]!.id, randomUUID()] }),
    ).rejects.toMatchObject({ code: "allergy.invalid" });
    await expect(
      view(p.partyId, { kind: "draft", draftId: d.id, lineIds: [d.lines[0]!.id, d.lines[0]!.id] }),
    ).rejects.toMatchObject({ code: "allergy.invalid" });
  });

  it("keeps parent, variant and each extra's own nutrition, including unknown and reviewed empty", async () => {
    const p = await party();
    const n = await nutritionProducts();
    const selected = fresh({
      menuItemId: n.menuItemId,
      variantId: n.variant.id,
      quantity: "2",
      extras: [
        {
          listId: n.list.id,
          picks: [n.egg, n.unknown, n.empty].map((product) => ({
            productId: product.id,
            quantity: 1,
          })),
        },
      ],
    });
    const d = await inTx(v, (tx) =>
      saveDraftForTest(tx, v.cfg, p.partyId, OPERATOR, {
        billId: p.tabId,
        draftId: null,
        revision: 0,
        lines: [selected],
      }),
    );
    const result = await view(p.partyId);
    expect(result.dishes).toEqual([
      {
        line: { kind: "draft", id: d.lines[0]!.id },
        billId: p.tabId,
        name: `${n.parent.name} (Large)`,
        quantity: "2.000",
        allergens: { gluten: { kinds: ["wheat"] } },
        extras: [
          { name: n.egg.name, quantity: "2.000", allergens: { eggs: {} } },
          { name: n.unknown.name, quantity: "2.000", allergens: null },
          { name: n.empty.name, quantity: "2.000", allergens: {} },
        ],
        sentAt: null,
        offeredBefore: false,
      },
    ]);
  });

  it("offers the whole mixed-course group plus only matching ungrouped held lines", async () => {
    const p = await party();
    const lines = await held(p, 4);
    const [a, b] = await inTx(v, async (tx) => [
      await createCourse(tx, v.cfg, { name: `First ${randomUUID().slice(0, 8)}`, displayOrder: 1 }),
      await createCourse(tx, v.cfg, { name: `Later ${randomUUID().slice(0, 8)}`, displayOrder: 2 }),
    ]);
    await v.db
      .update(workingOrderLines)
      .set({ courseId: a!.id })
      .where(eq(workingOrderLines.id, lines[0]!.id));
    await v.db
      .update(workingOrderLines)
      .set({ courseId: b!.id })
      .where(eq(workingOrderLines.id, lines[1]!.id));
    await v.db
      .update(workingOrderLines)
      .set({ groupId: null, courseId: a!.id })
      .where(eq(workingOrderLines.id, lines[2]!.id));
    await v.db
      .update(workingOrderLines)
      .set({ groupId: null, courseId: b!.id })
      .where(eq(workingOrderLines.id, lines[3]!.id));
    await split(v, p.partyId, p.tabId, [lines[1]!.lineNo]);
    const result = await view(p.partyId, { kind: "course", orderId: p.tabId, courseId: a!.id });
    expect(result.dishes.map((d) => d.line)).toEqual(
      expect.arrayContaining(lines.slice(0, 3).map((l) => ({ kind: "working", id: l.id }))),
    );
    expect(result.dishes).toHaveLength(3);
  });

  it("a recalled held dish keeps its source identity and does not become a new offer", async () => {
    const p = await party();
    const [line] = await held(p);
    const expectedPartyRevision = await revisionOf(v, p.partyId);
    const recalled = await inTx(v, async (tx) =>
      recallToDraft(tx, v.cfg, p.partyId, line!.id, {
        submissionId: randomUUID(),
        operatorId: OPERATOR,
        expectedPartyRevision,
        expectedEdit: await readBillEditState(tx, p.tabId),
      }),
    );
    const result = await view(p.partyId, {
      kind: "draft",
      draftId: recalled.draft.id,
      lineIds: [recalled.draft.lines[0]!.id],
    });
    expect(result.dishes).toEqual([
      expect.objectContaining({ line: { kind: "working", id: line!.id }, offeredBefore: true }),
    ]);
    expect((await view(p.partyId)).dishes).toHaveLength(1);
    await expect(
      view(p.partyId, { kind: "lines", orderId: p.tabId, lineNos: [line!.lineNo] }),
    ).rejects.toMatchObject({ code: "allergy.invalid" });
  });

  it("retains a no-preparation held dish without a ticket or HOLD printing", async () => {
    const p = await party();
    const n = await nutritionProducts();
    await inTx(v, async (tx) => {
      await setRoutingCell(
        tx,
        v.cfg,
        { row: { kind: "product", productId: n.egg.id }, zoneId: v.tables.zoneId },
        { kind: "no_preparation" },
      );
      await placeGroups(tx, v.cfg, p.partyId, {
        billId: p.tabId,
        operatorId: OPERATOR,
        groups: [
          { release: "hold", lines: [{ menuItemId: n.offers.offerFor(n.egg.id), quantity: "1" }] },
        ],
      });
    });
    const result = await view(p.partyId);
    expect(result.dishes).toEqual([
      expect.objectContaining({ name: n.egg.name, offeredBefore: true, sentAt: null }),
    ]);
    const tickets = await v.db
      .select()
      .from(ticketItems)
      .where(eq(ticketItems.workingOrderId, p.tabId));
    expect(tickets).toEqual([]);
    expect(
      (
        await view(p.partyId, {
          kind: "group",
          groupId: (
            await v.db.select().from(orderGroups).where(eq(orderGroups.partyId, p.partyId))
          )[0]!.id,
        })
      ).dishes,
    ).toHaveLength(1);
  });
  it("offers a fresh draft and retains an unticked held dish after a new read", async () => {
    const p = await party();
    const [line] = await held(p);
    const revision = await revisionOf(v, p.partyId);
    await inTx(v, (tx) =>
      savePartyAllergy(
        tx,
        p.partyId,
        revision,
        {
          answer: "allergies",
          guests: [{ who: "Window seat", allergens: { milk: {} }, note: null }],
        },
        OPERATOR,
      ),
    );
    const d = await draft(p);
    const result = await view(p.partyId);
    expect(result.snapshot.ticks).toEqual([]);
    expect(result.dishes).toHaveLength(2);
    expect(result.dishes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          line: { kind: "working", id: line!.id },
          billId: p.tabId,
          offeredBefore: true,
          sentAt: null,
        }),
        expect.objectContaining({
          line: { kind: "draft", id: d.lines[0]!.id },
          billId: p.tabId,
          offeredBefore: false,
          sentAt: null,
        }),
      ]),
    );
    expect((await view(p.partyId)).dishes).toEqual(result.dishes);
    expect(
      (await view(p.partyId, { kind: "draft", draftId: d.id, lineIds: [d.lines[0]!.id] })).dishes,
    ).toEqual([expect.objectContaining({ line: { kind: "draft", id: d.lines[0]!.id } })]);
  });

  it("resolves a held group across its bills without narrowing to the first bill", async () => {
    const p = await party();
    const lines = await held(p, 2);
    const bill = await split(v, p.partyId, p.tabId, [lines[1]!.lineNo]);
    const result = await view(p.partyId, { kind: "group", groupId: lines[0]!.groupId! });
    expect(result.dishes.map((d) => d.billId).sort()).toEqual([p.tabId, bill].sort());
    expect(result.dishes.map((d) => d.line)).toEqual(
      expect.arrayContaining(lines.map((l) => ({ kind: "working", id: l.id }))),
    );
    expect(result.dishes.every((d) => d.offeredBefore)).toBe(true);
  });

  it("resolves a held dish by itself", async () => {
    const p = await party();
    const lines = await held(p, 2);
    expect((await view(p.partyId, { kind: "held-line", lineId: lines[1]!.id })).dishes).toEqual([
      expect.objectContaining({ line: { kind: "working", id: lines[1]!.id } }),
    ]);
  });

  it("empty line selection releases only ungrouped held work", async () => {
    const p = await party();
    const lines = await held(p, 2);
    await v.db
      .update(workingOrderLines)
      .set({ groupId: null })
      .where(eq(workingOrderLines.id, lines[1]!.id));
    expect(
      (await view(p.partyId, { kind: "lines", orderId: p.tabId, lineNos: [] })).dishes,
    ).toEqual([
      expect.objectContaining({ line: { kind: "working", id: lines[1]!.id }, offeredBefore: true }),
    ]);
  });

  it("retains the named-held-group refusal", async () => {
    const p = await party();
    const [line] = await held(p);
    await expect(
      view(p.partyId, { kind: "lines", orderId: p.tabId, lineNos: [line!.lineNo] }),
    ).rejects.toMatchObject({ code: "group.line_held" });
  });

  it("refuses another party's group and draft selections", async () => {
    const a = await party(),
      b = await party();
    const [line] = await held(b);
    const d = await draft(b);
    await expect(view(a.partyId, { kind: "group", groupId: line!.groupId! })).rejects.toMatchObject(
      { code: "group.not_found" },
    );
    await expect(
      view(a.partyId, { kind: "draft", draftId: d.id, lineIds: [d.lines[0]!.id] }),
    ).rejects.toMatchObject({ code: "allergy.invalid" });
    await expect(
      view(a.partyId, { kind: "lines", orderId: b.tabId, lineNos: [] }),
    ).rejects.toMatchObject({ code: "allergy.invalid" });
  });

  it("does not treat a counter delivery table as a party", async () => {
    const p = await party();
    await v.db
      .update(workingOrders)
      .set({ partyId: null, deliveryTableId: p.tableId })
      .where(eq(workingOrders.id, p.tabId));
    await expect(
      view(p.partyId, { kind: "lines", orderId: p.tabId, lineNos: [] }),
    ).rejects.toMatchObject({ code: "allergy.invalid" });
  });

  it("a fired group's repeated preview contains no new release work", async () => {
    const p = await party();
    const [line] = await held(p);
    await v.db
      .update(orderGroups)
      .set({ state: "fired", firedAt: new Date().toISOString() })
      .where(and(eq(orderGroups.id, line!.groupId!), eq(orderGroups.partyId, p.partyId)));
    expect((await view(p.partyId, { kind: "group", groupId: line!.groupId! })).dishes).toEqual([]);
  });
});

describe("A669 allergy patch boundary", () => {
  it("retains before-images of deleted guests and reports only changed working assignments", async () => {
    const p = await party();
    const [a, b] = await held(p, 2);
    await inTx(v, (tx) =>
      VENUE_SERVICE.writePartyAllergy(
        tx,
        p.partyId,
        {
          answer: "allergies",
          guests: [
            { who: "Guest A", allergens: { milk: {} } },
            { who: "Guest B", allergens: { eggs: {} } },
          ],
        },
        OPERATOR,
      ),
    );
    const before = (await view(p.partyId)).snapshot;
    await inTx(v, (tx) =>
      VENUE_SERVICE.setAllergyLineTicks(tx, p.partyId, [
        { workingLineId: a!.id, guestId: before.guests[0]!.id },
        { workingLineId: b!.id, guestId: before.guests[1]!.id },
      ]),
    );
    const expected = (await view(p.partyId)).snapshot;
    const changes = await inTx(v, (tx) =>
      applyPartyAllergyPatch(
        tx,
        p.partyId,
        {
          party: { answer: "allergies", guests: [before.guests[1]!] },
          ticks: [],
        },
        OPERATOR,
        [],
      ),
    );
    expect(changes.before).toEqual(expected);
    expect(changes.after).toMatchObject({
      answer: "allergies",
      guests: [{ id: before.guests[1]!.id }],
      ticks: [{ guestId: before.guests[1]!.id, workingLineId: b!.id }],
    });
    expect(changes.workingLineIds).toEqual([a!.id]);
    expect(changes.after.revision).toBe(expected.revision);
    const changedGuest = await inTx(v, (tx) =>
      applyPartyAllergyPatch(
        tx,
        p.partyId,
        {
          party: {
            answer: "allergies",
            guests: [{ ...before.guests[1]!, note: "Separate utensils" }],
          },
          ticks: [],
        },
        OPERATOR,
        [],
      ),
    );
    expect(changedGuest.workingLineIds).toEqual([b!.id]);
  });
  it("maps submitted indexes to assigned parent ids and excludes lines outside the action set", async () => {
    const p = await party();
    const [a, b] = await held(p, 2);
    const allowed = [
      {
        ref: { kind: "submitted" as const, groupIndex: 1, lineIndex: 0 },
        workingLineId: a!.id,
        draftLineId: null,
      },
    ];
    const patch = {
      party: {
        answer: "allergies" as const,
        guests: [{ who: "Guest", allergens: { milk: {} }, note: null }],
      },
      ticks: [{ line: { kind: "submitted" as const, groupIndex: 1, lineIndex: 0 }, guestIndex: 0 }],
    };
    const changes = await inTx(v, (tx) =>
      applyPartyAllergyPatch(tx, p.partyId, patch, OPERATOR, allowed),
    );
    expect(changes.after.ticks).toEqual([
      { guestId: changes.after.guests[0]!.id, workingLineId: a!.id, draftLineId: null },
    ]);
    expect(changes.workingLineIds).toEqual([a!.id]);
    await expect(
      inTx(v, (tx) =>
        applyPartyAllergyPatch(
          tx,
          p.partyId,
          {
            ticks: [{ line: { kind: "working", id: b!.id }, guestIndex: null }],
          },
          OPERATOR,
          allowed,
        ),
      ),
    ).rejects.toMatchObject({ code: "allergy.invalid", params: { field: "ticks.0.line" } });
    expect((await view(p.partyId)).snapshot).toEqual(changes.after);
  });
});

describe("A669 allergy patch target identity", () => {
  it("assigns a draft and a working dish with the same UUID independently", async () => {
    const p = await party();
    const [line] = await held(p);
    const d = await draft(p);
    await v.db
      .update(orderDraftLines)
      .set({ id: line!.id })
      .where(eq(orderDraftLines.id, d.lines[0]!.id));
    const current = await view(p.partyId);
    const result = await inTx(v, (tx) =>
      applyPartyAllergyPatch(
        tx,
        p.partyId,
        {
          party: {
            answer: "allergies",
            guests: [
              { who: "Guest A", allergens: { milk: {} }, note: null },
              { who: "Guest B", allergens: { eggs: {} }, note: null },
            ],
          },
          ticks: [
            { line: { kind: "draft", id: line!.id }, guestIndex: 0 },
            { line: { kind: "working", id: line!.id }, guestIndex: 1 },
          ],
        },
        OPERATOR,
        allergyTargets(current),
      ),
    );
    expect(result.after.ticks).toEqual(
      expect.arrayContaining([
        { draftLineId: line!.id, workingLineId: null, guestId: result.after.guests[0]!.id },
        { draftLineId: null, workingLineId: line!.id, guestId: result.after.guests[1]!.id },
      ]),
    );
    expect(result.after.ticks).toHaveLength(2);
  });
});
