import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  deviceMadeHereStations,
  kitchenStations,
  locations,
  printJobs,
  printers,
  products,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  createExtraList,
  createProduct,
  readContentLanguages,
  setProductVariants,
  updateProduct,
  writeProductModifiers,
} from "@waitron/catalogue";
import { createPrinter } from "@waitron/printing";
import { setRoutingCell, writePrintHeldWork } from "@waitron/venue-service";
import type { AllergyGuestInput, AllergyPatch, KitchenAllergyBlock } from "@waitron/module";
import { locationId as brandLocationId } from "@waitron/shared";
import { readBillEditState } from "./bill-editing.js";
import {
  submitGroups,
  fireGroup,
  fireHeldLine,
  type GroupRelease,
  type SubmitGroupsInput,
} from "./order-groups.js";
import { submitDraft, type FreshDraftLineInput } from "./order-drafts.js";
import {
  createOpenOrder,
  fireCourse,
  fireableLineColumns,
  fireLines,
  sendLines,
  updateOrderLine,
} from "./working-order.js";
import { createCourse, createStation, setProductCourse } from "./kitchen.js";
import { attachPrinterToStation } from "./station-printers.js";
import { VENUE_SERVICE } from "./modules.js";
import { saveDraftForTest } from "./testing/draft-command-fixture.js";
import { ALLERGEN_NAMES, ALLERGEN_KIND_NAMES } from "./i18n/kitchen-allergy.js";
import { republishMenus } from "./testing/publish-menu.js";
import { routeProductTo } from "./testing/zone-offers.js";
import {
  OPERATOR,
  inTx,
  revisionOf,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let v: PartyVenue;
let stationId: string;
beforeEach(async () => {
  v = await setupPartyVenue(suite.db);
  const [station] = await v.db
    .select()
    .from(kitchenStations)
    .where(
      and(eq(kitchenStations.locationId, v.cfg.locationId), eq(kitchenStations.isDefault, true)),
    );
  stationId = station!.id;
  await inTx(v, (tx) =>
    updateProduct(tx, v.productId("Burger"), {
      allergens: { milk: {}, gluten: { kinds: ["wheat", "rye"] } },
    }),
  );
});

const guest = {
  who: "Window guest",
  allergens: { milk: {}, gluten: { kinds: ["wheat"] } },
  note: "Separate pan for this guest",
} satisfies AllergyGuestInput;
const wanted = {
  who: guest.who,
  allergens: { gluten: { kinds: ["wheat"] }, milk: {} },
  note: guest.note,
  clashes: { gluten: { kinds: ["rye", "wheat"] }, milk: {} },
  labels: {
    en: {
      avoids: ["Cereals containing gluten (Wheat)", "Milk"],
      clashes: ["Cereals containing gluten (Rye, Wheat)", "Milk"],
    },
    es: {
      avoids: [
        `${ALLERGEN_NAMES.gluten.es} (${ALLERGEN_KIND_NAMES.wheat!.es})`,
        ALLERGEN_NAMES.milk.es,
      ],
      clashes: [
        `${ALLERGEN_NAMES.gluten.es} (${ALLERGEN_KIND_NAMES.rye!.es}, ${ALLERGEN_KIND_NAMES.wheat!.es})`,
        ALLERGEN_NAMES.milk.es,
      ],
    },
  },
};
type Seated = Awaited<ReturnType<typeof seat>>;
async function party(): Promise<Seated> {
  return seat(v, await v.table("Allergy capture"));
}
async function command(
  p: Seated,
  release: GroupRelease = "fire",
  assigned = true,
  joinGroupId?: string,
): Promise<SubmitGroupsInput> {
  return {
    submissionId: randomUUID(),
    expectedPartyRevision: await revisionOf(v, p.partyId),
    operatorId: OPERATOR,
    expectedEdit: await inTx(v, (tx) => readBillEditState(tx, p.tabId)),
    groups: [
      {
        release,
        lines: [{ menuItemId: v.item("Burger"), quantity: "1", note: "Dish's own note" }],
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
    } satisfies AllergyPatch,
    ...(joinGroupId === undefined ? {} : { joinGroupId }),
  };
}
function copies(orderId: string) {
  return v.db
    .all<{
      id: string;
      lineId: string;
      frozen: string | null;
      original: string | null;
      current: string | null;
    }>(
      sql`
    select t.id, t.working_order_line_id as lineId, a.ticket_item_id as frozen,
      a.original_block as original, a.current_block as current
    from ticket_items t left join ticket_item_allergies a on a.ticket_item_id = t.id
    where t.working_order_id = ${orderId} order by t.rowid
  `,
    )
    .map(({ original, current, ...row }) => ({
      ...row,
      original: original === null ? null : (JSON.parse(original) as KitchenAllergyBlock),
      current: current === null ? null : (JSON.parse(current) as KitchenAllergyBlock),
    }));
}
function expectCopies(orderId: string, block: unknown = wanted) {
  const rows = copies(orderId);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toEqual({
    id: expect.any(String),
    lineId: expect.any(String),
    frozen: rows[0]!.id,
    original: block,
    current: block,
  });
  return rows[0]!;
}
async function printer() {
  return inTx(v, async (tx) => {
    const result = await createPrinter(tx, v.cfg, {
      name: "Kitchen paper",
      transport: "cloud_poll",
      pollId: randomUUID(),
    });
    await attachPrinterToStation(tx, {
      locationId: v.cfg.locationId,
      stationId,
      printerId: result.id,
    });
    return result.id;
  });
}

async function extraFixture(separate: boolean) {
  return inTx(v, async (tx) => {
    const [parent] = await tx
      .select()
      .from(products)
      .where(eq(products.id, v.productId("Burger")));
    const { defaultLanguage } = await readContentLanguages(tx, v.cfg.locale);
    const extra = await createProduct(tx, {
      catalogueId: parent!.catalogueId,
      categoryId: null,
      name: "Extra staff name",
      customerName: { [defaultLanguage]: "Customer side name" },
      kitchenName: "EXTRA KITCHEN",
      pricingUnit: "each",
      unitPrice: "1.00",
      vatClass: "reduced",
      allergens: { milk: {}, nuts: { kinds: ["almonds"] } },
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
        items: [{ productId: extra.id, maxQuantity: 1, preselected: false, price: "1.00" }],
      },
      v.cfg.locale,
    );
    await writeProductModifiers(tx, v.productId("Burger"), [{ kind: "extras", id: list.id }]);
    const station = separate
      ? (await createStation(tx, v.cfg, { name: "Sides station" })).id
      : stationId;
    await routeProductTo(tx, v.cfg, extra.id, station);
    await republishMenus(tx);
    return { extraId: extra.id, listId: list.id, stationId: station };
  });
}

function addExtra(ask: SubmitGroupsInput, extra: Awaited<ReturnType<typeof extraFixture>>) {
  ask.groups[0]!.lines[0]!.extras = [
    { listId: extra.listId, picks: [{ productId: extra.extraId, quantity: 1 }] },
  ];
  ask.allergy = {
    party: {
      answer: "allergies",
      guests: [
        {
          who: guest.who,
          allergens: { milk: {}, nuts: { kinds: ["almonds"] } },
          note: guest.note,
        },
      ],
    },
    ticks: [{ line: { kind: "submitted", groupIndex: 0, lineIndex: 0 }, guestIndex: 0 }],
  };
}

const extraBlock = {
  who: guest.who,
  allergens: { milk: {}, nuts: { kinds: ["almonds"] } },
  note: guest.note,
  clashes: { milk: {}, nuts: { kinds: ["almonds"] } },
  labels: {
    en: { avoids: ["Milk", "Nuts (Almonds)"], clashes: ["Milk", "Nuts (Almonds)"] },
    es: {
      avoids: [
        ALLERGEN_NAMES.milk.es,
        `${ALLERGEN_NAMES.nuts.es} (${ALLERGEN_KIND_NAMES.almonds!.es})`,
      ],
      clashes: [
        ALLERGEN_NAMES.milk.es,
        `${ALLERGEN_NAMES.nuts.es} (${ALLERGEN_KIND_NAMES.almonds!.es})`,
      ],
    },
  },
};

describe("A669 capture", () => {
  it.each([true, false])(
    "captures direct group send before output, assigned=%s, with no printer",
    async (assigned) => {
      const p = await party();
      const ask = await command(p, "fire", assigned);
      await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, ask));
      expectCopies(p.tabId, assigned ? wanted : null);
      expect(await v.db.select().from(printJobs)).toEqual([]);
      expect(
        await v.db
          .select({ note: workingOrderLines.note })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, p.tabId)),
      ).toEqual([{ note: "Dish's own note" }]);
    },
  );

  it("captures draft ticks after their move to newly submitted lines", async () => {
    const p = await party();
    const line: FreshDraftLineInput = {
      sourceLineId: null,
      menuItemId: v.item("Burger"),
      variantId: null,
      menuVersionId: null,
      options: [],
      extras: [],
      note: "Dish's own note",
      quantity: "1",
      courseId: null,
      noMerge: true,
      slot: 0,
      joinGroupId: null,
      afterGroupId: null,
    };
    const d = await inTx(v, (tx) =>
      saveDraftForTest(tx, v.cfg, p.partyId, OPERATOR, {
        billId: p.tabId,
        draftId: null,
        revision: 0,
        lines: [line],
      }),
    );
    const ask = {
      submissionId: randomUUID(),
      expectedPartyRevision: await revisionOf(v, p.partyId),
      operatorId: OPERATOR,
      expectedEdit: await inTx(v, (tx) => readBillEditState(tx, p.tabId)),
      draftRevision: d.revision,
      groups: [{ release: "fire" as const, lineIds: [d.lines[0]!.id] }],
      allergy: {
        party: { answer: "allergies" as const, guests: [guest] },
        ticks: [{ line: { kind: "draft" as const, id: d.lines[0]!.id }, guestIndex: 0 }],
      },
    };
    await inTx(v, (tx) => submitDraft(tx, v.cfg, p.partyId, d.id, ask));
    expectCopies(p.tabId);
  });

  it.each(["line", "group", "held-line", "course"] as const)(
    "captures %s release after an unprinted hold using the latest guest",
    async (path) => {
      const p = await party();
      const course = await inTx(v, async (tx) => {
        const result = await createCourse(tx, v.cfg, { name: "Mains", displayOrder: 1 });
        await setProductCourse(tx, v.cfg, v.productId("Burger"), result.id);
        return result.id;
      });
      const ask = await command(p, "hold");
      const result = await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, ask));
      const [held] = copies(p.tabId);
      expect(held).toMatchObject({ frozen: null, original: null, current: null });
      const snapshot = await inTx(v, (tx) => VENUE_SERVICE.readPartyAllergy(tx, p.partyId));
      await inTx(v, (tx) =>
        VENUE_SERVICE.writePartyAllergy(
          tx,
          p.partyId,
          {
            answer: "allergies",
            guests: [{ ...guest, id: snapshot.guests[0]!.id, who: "New window guest" }],
          },
          OPERATOR,
        ),
      );
      const release = {
        submissionId: randomUUID(),
        expectedPartyRevision: await revisionOf(v, p.partyId),
        operatorId: OPERATOR,
      };
      if (path === "line")
        await v.db
          .update(workingOrderLines)
          .set({ groupId: null })
          .where(eq(workingOrderLines.workingOrderId, p.tabId));
      await inTx(v, async (tx) => {
        if (path === "group") await fireGroup(tx, v.cfg, p.partyId, result.groups[0]!.id, release);
        else if (path === "held-line")
          await fireHeldLine(tx, v.cfg, p.partyId, held!.lineId, release);
        else if (path === "course")
          await fireCourse(tx, v.cfg, p.tabId, course, { personId: OPERATOR }, undefined, release);
        else
          await sendLines(
            tx,
            v.cfg,
            p.tabId,
            [1],
            {
              operatorId: OPERATOR,
              expectedEdit: await readBillEditState(tx, p.tabId),
            },
            undefined,
            release,
          );
      });
      expectCopies(p.tabId, { ...wanted, who: "New window guest" });
    },
  );

  it("freezes a queued HOLD copy and never overwrites it at later fire or exact retry", async () => {
    const p = await party();
    await printer();
    await inTx(v, (tx) => writePrintHeldWork(tx, true));
    const ask = await command(p, "hold");
    const result = await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, ask));
    const old = expectCopies(p.tabId);
    const jobsBefore = await v.db.select().from(printJobs);
    expect(jobsBefore).toHaveLength(1);
    const snapshot = await inTx(v, (tx) => VENUE_SERVICE.readPartyAllergy(tx, p.partyId));
    await inTx(v, (tx) =>
      VENUE_SERVICE.writePartyAllergy(
        tx,
        p.partyId,
        {
          answer: "allergies",
          guests: [
            {
              id: snapshot.guests[0]!.id,
              who: "Changed guest",
              allergens: { eggs: {} },
              note: "Changed note",
            },
          ],
        },
        OPERATOR,
      ),
    );
    const release = {
      submissionId: randomUUID(),
      expectedPartyRevision: await revisionOf(v, p.partyId),
      operatorId: OPERATOR,
    };
    await inTx(v, (tx) => fireGroup(tx, v.cfg, p.partyId, result.groups[0]!.id, release));
    expect(copies(p.tabId)).toEqual([old]);
    const jobs = await v.db.select().from(printJobs);
    await inTx(v, (tx) => fireGroup(tx, v.cfg, p.partyId, result.groups[0]!.id, release));
    expect(copies(p.tabId)).toEqual([old]);
    expect(await v.db.select().from(printJobs)).toEqual(jobs);
    expect((await v.db.select().from(printJobs))[0]!.payload).toEqual(jobsBefore[0]!.payload);
  });

  it("freezes new dishes joining an already printed HOLD group", async () => {
    const p = await party();
    await printer();
    await inTx(v, (tx) => writePrintHeldWork(tx, true));
    const first = await command(p, "hold");
    const sent = await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, first));
    const next = await command(p, "hold", true, sent.groups[0]!.id);
    const existing = await inTx(v, (tx) => VENUE_SERVICE.readPartyAllergy(tx, p.partyId));
    next.allergy!.party!.guests[0] = { ...guest, id: existing.guests[0]!.id };
    next.groups[0]!.lines[0]!.note = "Second dish note";
    await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, next));
    const rows = copies(p.tabId);
    expect(rows).toHaveLength(2);
    for (const row of rows)
      expect(row).toEqual({
        id: expect.any(String),
        lineId: expect.any(String),
        frozen: row.id,
        original: wanted,
        current: wanted,
      });
  });

  it.each(["fire", "hold"] as const)(
    "captures a new routed extra added to existing %s work",
    async (release) => {
      const extra = await extraFixture(true);
      const p = await party();
      if (release === "hold") {
        await printer();
        await inTx(v, async (tx) => {
          const result = await createPrinter(tx, v.cfg, {
            name: "Side paper",
            transport: "cloud_poll",
            pollId: randomUUID(),
          });
          await attachPrinterToStation(tx, {
            locationId: v.cfg.locationId,
            stationId: extra.stationId,
            printerId: result.id,
          });
          await writePrintHeldWork(tx, true);
        });
      }
      const ask = await command(p, release);
      addExtra(ask, extra);
      const selection = ask.groups[0]!.lines[0]!.extras;
      ask.groups[0]!.lines[0]!.extras = [];
      await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, ask));
      const original = copies(p.tabId)[0]!;
      expect(original.original).toMatchObject({
        allergens: extraBlock.allergens,
        clashes: { milk: {} },
      });
      await inTx(v, async (tx) => {
        const [order] = await tx
          .select({ revision: workingOrders.revision })
          .from(workingOrders)
          .where(eq(workingOrders.id, p.tabId));
        await updateOrderLine(tx, v.cfg, p.tabId, 1, { extras: selection }, order!.revision, {
          operatorId: OPERATOR,
          expectedEdit: await readBillEditState(tx, p.tabId),
        });
      });
      const rows = copies(p.tabId);
      expect(rows).toHaveLength(2);
      expect(rows[0]!.lineId).toBe(original.lineId);
      expect(rows[0]!.frozen).toBe(rows[0]!.id);
      expect(rows[0]!.original).toEqual(original.original);
      expect(rows[0]!.current).toEqual(original.current);
      expect(rows[1]).toEqual({
        id: expect.any(String),
        lineId: expect.any(String),
        frozen: rows[1]!.id,
        original: extraBlock,
        current: extraBlock,
      });
    },
  );

  it("keeps the original after guest deletion and product changes", async () => {
    const p = await party();
    const ask = await command(p);
    await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, ask));
    const old = expectCopies(p.tabId);
    await inTx(v, (tx) =>
      VENUE_SERVICE.writePartyAllergy(tx, p.partyId, { answer: "none", guests: [] }, OPERATOR),
    );
    await inTx(v, (tx) => updateProduct(tx, v.productId("Burger"), { allergens: {} }));
    const { enqueueKitchenTickets } = await import("./kitchen-print.js");
    await inTx(v, (tx) =>
      enqueueKitchenTickets(tx, v.cfg, p.tabId, [{ workingOrderLineId: old.lineId, stationId }]),
    );
    expect(copies(p.tabId)).toEqual([old]);
  });

  it("retains distinct original and current blocks for a replaced dish and its kept routed extra", async () => {
    await printer();
    const p = await party();
    const extra = await extraFixture(true);
    const ask = await command(p);
    addExtra(ask, extra);
    await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, ask));
    const original = copies(p.tabId);
    expect(original).toHaveLength(2);
    for (const row of original)
      await inTx(v, (tx) =>
        VENUE_SERVICE.setTicketAllergyCurrent(tx, row.id, {
          ...row.original!,
          who: "Latest guest",
          note: "Latest pan instruction",
        }),
      );
    const expected = copies(p.tabId);
    const money = () =>
      v.db
        .select({
          id: workingOrderLines.id,
          quantity: workingOrderLines.quantity,
          price: workingOrderLines.unitPriceGross,
          total: workingOrderLines.lineTotal,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, p.tabId))
        .orderBy(workingOrderLines.lineNo);
    const moneyBefore = await money();
    const oldJobs = await v.db.select().from(printJobs);
    await inTx(v, async (tx) => {
      const [order] = await tx
        .select({ revision: workingOrders.revision })
        .from(workingOrders)
        .where(eq(workingOrders.id, p.tabId));
      await updateOrderLine(tx, v.cfg, p.tabId, 1, { note: "New dish note" }, order!.revision, {
        operatorId: OPERATOR,
        expectedEdit: await readBillEditState(tx, p.tabId),
      });
    });
    const after = copies(p.tabId);
    expect(after).toHaveLength(2);
    for (const row of expected) {
      const replacement = after.find((next) => next.lineId === row.lineId)!;
      expect(replacement.frozen).toBe(replacement.id);
      expect(replacement.original).toEqual(row.original);
      expect(replacement.current).toEqual(row.current);
    }
    expect(await money()).toEqual(moneyBefore);
    const jobs = await v.db.select().from(printJobs);
    for (const old of oldJobs) expect(jobs.find((job) => job.id === old.id)).toEqual(old);
  });

  it("retains an explicit frozen null when replacement happens after a later assignment", async () => {
    const p = await party();
    const commandInput = await command(p, "fire", false);
    await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, commandInput));
    const old = expectCopies(p.tabId, null);
    const snapshot = await inTx(v, (tx) => VENUE_SERVICE.readPartyAllergy(tx, p.partyId));
    await inTx(v, (tx) =>
      VENUE_SERVICE.setAllergyLineTicks(tx, p.partyId, [
        {
          guestId: snapshot.guests[0]!.id,
          draftLineId: null,
          workingLineId: old.lineId,
        },
      ]),
    );
    await inTx(v, async (tx) => {
      const [order] = await tx
        .select({ revision: workingOrders.revision })
        .from(workingOrders)
        .where(eq(workingOrders.id, p.tabId));
      await updateOrderLine(tx, v.cfg, p.tabId, 1, { note: "Changed note" }, order!.revision, {
        operatorId: OPERATOR,
        expectedEdit: await readBillEditState(tx, p.tabId),
      });
    });
    const replacement = expectCopies(p.tabId, null);
    expect(replacement.lineId).toBe(old.lineId);
  });

  it("keeps counter entry free of party allergy copies", async () => {
    const orderId = randomUUID();
    await inTx(v, async (tx) => {
      await createOpenOrder(
        tx,
        v.cfg,
        orderId,
        [{ menuItemId: v.counterItem("Burger"), quantity: "1" }],
        null,
        { zoneId: v.counter.zoneId, creditedTo: OPERATOR },
      );
      const lines = await tx
        .select(fireableLineColumns)
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, orderId));
      await fireLines(tx, v.cfg, orderId, lines);
    });
    const rows = copies(orderId);
    expect(rows).not.toHaveLength(0);
    expect(rows.every((row) => row.frozen === null)).toBe(true);
  });

  it.each([false, true])(
    "captures active extras with the parent guest, separate station=%s",
    async (separate) => {
      const extra = await extraFixture(separate);
      const p = await party();
      const ask = await command(p);
      addExtra(ask, extra);
      await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, ask));
      const rows = copies(p.tabId);
      expect(rows).toHaveLength(separate ? 2 : 1);
      for (const row of rows)
        expect(row).toEqual({
          id: expect.any(String),
          lineId: expect.any(String),
          frozen: row.id,
          original: extraBlock,
          current: extraBlock,
        });
    },
  );

  it.each([false, true])(
    "keeps known extra clashes with an unknown parent, no preparation=%s",
    async (noPreparation) => {
      const extra = await extraFixture(true);
      await inTx(v, async (tx) => {
        await updateProduct(tx, v.productId("Burger"), { allergens: null });
        if (noPreparation)
          await setRoutingCell(
            tx,
            v.cfg,
            {
              row: { kind: "product", productId: v.productId("Burger") },
              zoneId: null,
            },
            { kind: "no_preparation" },
          );
        await republishMenus(tx);
      });
      const p = await party();
      const ask = await command(p);
      addExtra(ask, extra);
      await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, ask));
      const rows = copies(p.tabId);
      expect(rows).toHaveLength(noPreparation ? 1 : 2);
      for (const row of rows)
        expect(row).toEqual({
          id: expect.any(String),
          lineId: expect.any(String),
          frozen: row.id,
          original: extraBlock,
          current: extraBlock,
        });
    },
  );

  it("freezes HOLD only for the station receiving paper, then captures the other at fire", async () => {
    const extra = await extraFixture(true);
    const p = await party();
    await printer();
    await inTx(v, (tx) => writePrintHeldWork(tx, true));
    const ask = await command(p, "hold");
    addExtra(ask, extra);
    const result = await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, ask));
    const held = copies(p.tabId);
    expect(held).toHaveLength(2);
    expect(held[0]).toEqual({
      id: expect.any(String),
      lineId: expect.any(String),
      frozen: held[0]!.id,
      original: extraBlock,
      current: extraBlock,
    });
    expect(held[1]).toMatchObject({ frozen: null, original: null, current: null });
    const snapshot = await inTx(v, (tx) => VENUE_SERVICE.readPartyAllergy(tx, p.partyId));
    await inTx(v, (tx) =>
      VENUE_SERVICE.writePartyAllergy(
        tx,
        p.partyId,
        {
          answer: "allergies",
          guests: [{ ...snapshot.guests[0]!, who: "Later guest" }],
        },
        OPERATOR,
      ),
    );
    const release = {
      submissionId: randomUUID(),
      expectedPartyRevision: await revisionOf(v, p.partyId),
      operatorId: OPERATOR,
    };
    await inTx(v, (tx) => fireGroup(tx, v.cfg, p.partyId, result.groups[0]!.id, release));
    expect(copies(p.tabId)[0]).toEqual(held[0]);
    expect(copies(p.tabId)[1]).toEqual({
      id: held[1]!.id,
      lineId: held[1]!.lineId,
      frozen: held[1]!.id,
      original: { ...extraBlock, who: "Later guest" },
      current: { ...extraBlock, who: "Later guest" },
    });
  });

  it("does not freeze an unprinted HOLD when its mapped printer is inactive", async () => {
    const p = await party();
    const id = await printer();
    await v.db.update(printers).set({ active: false }).where(eq(printers.id, id));
    await inTx(v, (tx) => writePrintHeldWork(tx, true));
    const ask = await command(p, "hold");
    await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, ask));
    expect(copies(p.tabId)).toHaveLength(1);
    expect(copies(p.tabId)[0]).toMatchObject({ frozen: null, original: null, current: null });
    expect(await v.db.select().from(printJobs)).toEqual([]);
  });

  it("does not freeze made-here work", async () => {
    const p = await party();
    await v.db
      .insert(deviceMadeHereStations)
      .values({ deviceId: v.cfg.origin.deviceId, stationId });
    const ask = await command(p);
    await inTx(v, (tx) =>
      submitGroups(tx, { ...v.cfg, sendingDeviceId: v.cfg.origin.deviceId }, p.partyId, ask),
    );
    expect(copies(p.tabId)).toHaveLength(1);
    expect(copies(p.tabId)[0]).toMatchObject({ frozen: null, original: null, current: null });
    expect(
      await v.db
        .select({ madeHere: ticketItems.madeHere })
        .from(ticketItems)
        .where(eq(ticketItems.workingOrderId, p.tabId)),
    ).toEqual([{ madeHere: true }]);
  });

  it("excludes an extra removed before the first fire from the copied clashes", async () => {
    const extra = await extraFixture(true);
    const p = await party();
    const ask = await command(p, "hold");
    addExtra(ask, extra);
    const result = await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, ask));
    await v.db
      .delete(workingOrderLines)
      .where(
        and(
          eq(workingOrderLines.workingOrderId, p.tabId),
          eq(workingOrderLines.productId, extra.extraId),
        ),
      );
    const release = {
      submissionId: randomUUID(),
      expectedPartyRevision: await revisionOf(v, p.partyId),
      operatorId: OPERATOR,
    };
    await inTx(v, (tx) => fireGroup(tx, v.cfg, p.partyId, result.groups[0]!.id, release));
    expectCopies(p.tabId, {
      ...extraBlock,
      clashes: { milk: {} },
      labels: {
        en: { avoids: extraBlock.labels.en.avoids, clashes: ["Milk"] },
        es: { avoids: extraBlock.labels.es.avoids, clashes: [ALLERGEN_NAMES.milk.es] },
      },
    });
  });

  it("does not first-freeze a cancellation or removed-quantity correction", async () => {
    const p = await party();
    const ask = await command(p, "hold");
    await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, ask));
    const row = copies(p.tabId)[0]!;
    await printer();
    const { enqueueHoldCorrections } = await import("./kitchen-print.js");
    for (const change of [
      { kind: "HOLD CANCELLED" as const },
      { kind: "HOLD CHANGED" as const, direction: "removed" as const },
    ]) {
      await inTx(v, (tx) =>
        enqueueHoldCorrections(
          tx,
          v.cfg,
          p.tabId,
          [
            {
              workingOrderLineId: row.lineId,
              stationId,
              quantity: 1000,
              wasStarted: false,
              group: 1,
            },
          ],
          change,
        ),
      );
      expect(copies(p.tabId)).toEqual([row]);
    }
    expect(await v.db.select().from(printJobs)).toHaveLength(2);
  });

  it("leaves absent tickets and another location's work untouched", async () => {
    const p = await party();
    const ask = await command(p, "hold");
    await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, ask));
    const rows = copies(p.tabId);
    const [other] = await v.db
      .insert(locations)
      .values({
        name: "Other room",
        invoiceLocales: ["en"],
        operationDescription: "Restaurant",
      })
      .returning();
    const { freezeKitchenAllergies, freezeKitchenAllergyItems } =
      await import("./kitchen-allergy.js");
    await inTx(v, (tx) => freezeKitchenAllergies(tx, v.cfg, []));
    await inTx(v, (tx) => freezeKitchenAllergies(tx, v.cfg, [randomUUID()]));
    await inTx(v, (tx) =>
      freezeKitchenAllergies(tx, { ...v.cfg, locationId: brandLocationId(other!.id) }, [
        rows[0]!.id,
      ]),
    );
    await inTx(v, (tx) =>
      freezeKitchenAllergyItems(tx, v.cfg, p.tabId, [
        {
          workingOrderLineId: rows[0]!.lineId,
          stationId: randomUUID(),
        },
      ]),
    );
    expect(copies(p.tabId)).toEqual(rows);
  });

  it("uses inherited variant nutrition when the variant has no own profile", async () => {
    const variants = await inTx(v, async (tx) => {
      const { defaultLanguage } = await readContentLanguages(tx, v.cfg.locale);
      const values = await setProductVariants(
        tx,
        v.productId("Burger"),
        [
          {
            name: "Large staff name",
            customerName: { [defaultLanguage]: "Large customer name" },
            kitchenName: "LARGE KITCHEN",
            image: null,
            unitPrice: null,
            available: true,
          },
        ],
        v.cfg.locale,
      );
      await republishMenus(tx);
      return values;
    });
    const p = await party();
    const ask = await command(p);
    ask.groups[0]!.lines[0]!.variantId = variants[0]!.id;
    await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, ask));
    expectCopies(p.tabId);
  });

  it("keeps the frozen labels after both active dictionaries change, while a new explicit copy uses new labels", async () => {
    const p = await party();
    const ask = await command(p);
    await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, ask));
    const row = expectCopies(p.tabId);
    const old = structuredClone(ALLERGEN_NAMES.milk);
    try {
      Object.assign(ALLERGEN_NAMES.milk, { en: "Updated milk name", es: "Updated alternate name" });
      const { freezeKitchenAllergies, resolveKitchenAllergyBlocks } =
        await import("./kitchen-allergy.js");
      await inTx(v, (tx) => freezeKitchenAllergies(tx, v.cfg, [row.id]));
      expect(copies(p.tabId)).toEqual([row]);
      const next = await inTx(v, (tx) => resolveKitchenAllergyBlocks(tx, v.cfg, [row.id]));
      expect(next.get(row.id)?.labels.en.avoids).toEqual([
        "Cereals containing gluten (Wheat)",
        "Updated milk name",
      ]);
      expect(next.get(row.id)?.labels.es.avoids).toEqual([
        wanted.labels.es.avoids[0],
        "Updated alternate name",
      ]);
      expect(copies(p.tabId)).toEqual([row]);
    } finally {
      Object.assign(ALLERGEN_NAMES.milk, old);
    }
  });
});
