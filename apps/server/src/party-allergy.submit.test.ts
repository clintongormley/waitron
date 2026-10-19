import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  orderDraftLines,
  orderGroups,
  parties,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import type { AllergyPatch } from "@waitron/module";
import { writeEditSentLines } from "@waitron/venue-service";
import { readBillEditState } from "./bill-editing.js";
import { submitDraft, type FreshDraftLineInput } from "./order-drafts.js";
import { submitGroups, type GroupRelease } from "./order-groups.js";
import { readAllergySendView, readPartyAllergyView } from "./party-allergy.js";
import { VENUE_SERVICE } from "./modules.js";
import { AppError } from "@waitron/shared";
import * as orderWrites from "./working-order.js";
import { recallToDraft } from "./draft-recall.js";
import {
  createCatalogue,
  createCategory,
  createProduct,
  createExtraList,
  assignCatalogueToLocation,
  writeProductModifiers,
} from "@waitron/catalogue";
import { offerProducts } from "./testing/zone-offers.js";
import { publishWorkingMenu } from "./testing/publish-menu.js";
import { saveDraftForTest } from "./testing/draft-command-fixture.js";
import {
  OPERATOR,
  inTx,
  revisionOf,
  seat,
  setupPartyVenue,
  type PartyVenue,
} from "./testing/party-venue.js";

let v: PartyVenue;
useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  resetPerTest: false,
  setup: async (db) => {
    v = await setupPartyVenue(db);
  },
});

async function party() {
  return seat(v, await v.table(`Submit allergy ${randomUUID().slice(0, 8)}`));
}
type Party = Awaited<ReturnType<typeof party>>;
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
async function draft(p: Party, count = 1) {
  return inTx(v, (tx) =>
    saveDraftForTest(tx, v.cfg, p.partyId, OPERATOR, {
      billId: p.tabId,
      draftId: null,
      revision: 0,
      lines: Array.from({ length: count }, () => fresh()),
    }),
  );
}
async function frozen() {
  return Object.fromEntries(
    v.db
      .all<{ name: string }>(sql`select name from sqlite_master where type='table' order by name`)
      .map(({ name }) => [
        name,
        v.db.all<Record<string, unknown>>(
          sql`select * from ${sql.identifier(name)} order by rowid`,
        ),
      ]),
  );
}
async function snapshot(p: Party) {
  return inTx(v, (tx) => VENUE_SERVICE.readPartyAllergy(tx, p.partyId));
}
const none: AllergyPatch = { party: { answer: "none", guests: [] }, ticks: [] };
const guests: NonNullable<AllergyPatch["party"]> = {
  answer: "allergies",
  guests: [
    { who: "Alex", allergens: { milk: {} }, note: "First guest note" },
    { who: "Sam", allergens: { eggs: {} }, note: "Second guest note" },
  ],
};
async function directCommand(p: Party, release: GroupRelease = "fire", allergy?: AllergyPatch) {
  return {
    submissionId: randomUUID(),
    expectedPartyRevision: await revisionOf(v, p.partyId),
    operatorId: OPERATOR,
    expectedEdit: await inTx(v, (tx) => readBillEditState(tx, p.tabId)),
    groups: [{ release, lines: [{ menuItemId: v.item("Burger"), quantity: "1" }] }],
    ...(allergy === undefined ? {} : { allergy }),
  };
}
async function draftCommand(
  p: Party,
  d: Awaited<ReturnType<typeof draft>>,
  release: GroupRelease = "fire",
  allergy?: AllergyPatch,
) {
  return {
    submissionId: randomUUID(),
    expectedPartyRevision: await revisionOf(v, p.partyId),
    operatorId: OPERATOR,
    expectedEdit: await inTx(v, (tx) => readBillEditState(tx, p.tabId)),
    draftRevision: d.revision,
    groups: [{ release, lineIds: d.lines.map((l) => l.id) }],
    ...(allergy === undefined ? {} : { allergy }),
  };
}

describe("A669 atomic submit", () => {
  for (const path of ["draft", "direct"] as const) {
    it.each(["fire", "hold"] as const)(
      `${path} refuses unanswered %s without any writes`,
      async (release) => {
        const p = await party();
        const d = path === "draft" ? await draft(p) : null;
        const ask =
          d === null ? await directCommand(p, release) : await draftCommand(p, d, release);
        const before = await frozen();
        await expect(
          inTx(v, (tx) =>
            d === null
              ? submitGroups(tx, v.cfg, p.partyId, ask as Awaited<ReturnType<typeof directCommand>>)
              : submitDraft(
                  tx,
                  v.cfg,
                  p.partyId,
                  d.id,
                  ask as Awaited<ReturnType<typeof draftCommand>>,
                ),
          ),
        ).rejects.toMatchObject({ code: "allergy.unanswered" });
        expect(await frozen()).toEqual(before);
      },
    );
    it(`${path} saves explicit none and replays before later party revisions`, async () => {
      const p = await party();
      const d = path === "draft" ? await draft(p) : null;
      const ask =
        d === null ? await directCommand(p, "fire", none) : await draftCommand(p, d, "fire", none);
      const run = () =>
        inTx(v, (tx) =>
          d === null
            ? submitGroups(tx, v.cfg, p.partyId, ask as Awaited<ReturnType<typeof directCommand>>)
            : submitDraft(
                tx,
                v.cfg,
                p.partyId,
                d.id,
                ask as Awaited<ReturnType<typeof draftCommand>>,
              ),
        );
      const result = await run();
      expect((await snapshot(p)).answer).toBe("none");
      expect(await revisionOf(v, p.partyId)).toBe(ask.expectedPartyRevision + 1);
      await v.db
        .update(parties)
        .set({
          revision: ask.expectedPartyRevision + 20,
          state: "closed",
          closedAt: "2026-10-19T12:00:00.000Z",
        })
        .where(eq(parties.id, p.partyId));
      const beforeReplay = await frozen();
      expect(await run()).toEqual(result);
      expect(await frozen()).toEqual(beforeReplay);
      const changed = { ...ask, allergy: { party: guests, ticks: [] } };
      await expect(
        inTx(v, (tx) =>
          d === null
            ? submitGroups(
                tx,
                v.cfg,
                p.partyId,
                changed as Awaited<ReturnType<typeof directCommand>>,
              )
            : submitDraft(
                tx,
                v.cfg,
                p.partyId,
                d.id,
                changed as Awaited<ReturnType<typeof draftCommand>>,
              ),
        ),
      ).rejects.toMatchObject({ code: "submission.id_reused" });
      expect(await frozen()).toEqual(beforeReplay);
    });
  }

  it("applies incoming draft ticks before duplicate dishes can merge, mapping reordered partial groups", async () => {
    const p = await party(),
      d = await draft(p, 3);
    const [a, b, c] = d.lines;
    await v.db
      .update(orderDraftLines)
      .set({ noMerge: false })
      .where(eq(orderDraftLines.draftId, d.id));
    const allergy: AllergyPatch = {
      party: guests,
      ticks: [
        { line: { kind: "draft", id: a!.id }, guestIndex: 0 },
        { line: { kind: "draft", id: c!.id }, guestIndex: 1 },
      ],
    };
    const ask = {
      ...(await draftCommand(p, d, "hold", allergy)),
      groups: [{ release: "hold" as const, lineIds: [c!.id, a!.id] }],
    };
    const result = await inTx(v, (tx) => submitDraft(tx, v.cfg, p.partyId, d.id, ask));
    expect(result.draft!.lines.map((l) => l.id)).toEqual([b!.id]);
    const saved = await snapshot(p);
    expect(saved.answer).toBe("allergies");
    expect(saved.guests.map((g) => g.who)).toEqual(["Alex", "Sam"]);
    expect(saved.ticks).toHaveLength(2);
    expect(saved.ticks.every((t) => t.draftLineId === null && t.workingLineId !== null)).toBe(true);
    const rows = await v.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, p.tabId))
      .orderBy(workingOrderLines.lineNo);
    expect(rows.map((r) => r.quantity)).toEqual([1000, 1000]);
    expect(saved.ticks.find((t) => t.guestId === saved.guests[0]!.id)!.workingLineId).toBe(
      rows[0]!.id,
    );
    expect(saved.ticks.find((t) => t.guestId === saved.guests[1]!.id)!.workingLineId).toBe(
      rows[1]!.id,
    );
    const view = await inTx(v, (tx) => readPartyAllergyView(tx, v.cfg, p.partyId));
    expect(
      view.dishes.filter((d) => d.line.kind === "working").map((d) => d.offeredBefore),
    ).toEqual([true, true]);
    expect(view.dishes.find((d) => d.line.kind === "draft")!.offeredBefore).toBe(false);
  });

  it("maps direct submitted indexes to separate parent rows across reordered groups", async () => {
    const p = await party();
    const allergy: AllergyPatch = {
      party: guests,
      ticks: [
        { line: { kind: "submitted", groupIndex: 1, lineIndex: 0 }, guestIndex: 0 },
        { line: { kind: "submitted", groupIndex: 0, lineIndex: 1 }, guestIndex: 1 },
      ],
    };
    const ask = {
      ...(await directCommand(p, "hold", allergy)),
      groups: [
        {
          release: "hold" as const,
          lines: [
            { menuItemId: v.item("Burger"), quantity: "2" },
            { menuItemId: v.item("Burger"), quantity: "3" },
          ],
        },
        { release: "fire" as const, lines: [{ menuItemId: v.item("Burger"), quantity: "4" }] },
      ],
    };
    await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, ask));
    const saved = await snapshot(p);
    const rows = await v.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, p.tabId))
      .orderBy(workingOrderLines.lineNo);
    expect(rows.map((r) => r.quantity)).toEqual([2000, 3000, 4000]);
    expect(saved.ticks).toHaveLength(2);
    expect(saved.ticks.find((t) => t.guestId === saved.guests[0]!.id)!.workingLineId).toBe(
      rows[2]!.id,
    );
    expect(saved.ticks.find((t) => t.guestId === saved.guests[1]!.id)!.workingLineId).toBe(
      rows[1]!.id,
    );
  });

  it("replays equivalent uppercase draft tick references from the normalized packet", async () => {
    const p = await party(),
      d = await draft(p);
    const ask = await draftCommand(p, d, "hold", {
      party: guests,
      ticks: [{ line: { kind: "draft", id: d.lines[0]!.id.toUpperCase() }, guestIndex: 0 }],
    });
    const result = await inTx(v, (tx) => submitDraft(tx, v.cfg, p.partyId, d.id, ask));
    const before = await frozen();
    const replay = {
      ...ask,
      allergy: {
        ...ask.allergy!,
        ticks: [
          { line: { kind: "draft" as const, id: d.lines[0]!.id.toLowerCase() }, guestIndex: 0 },
        ],
      },
    };
    expect(await inTx(v, (tx) => submitDraft(tx, v.cfg, p.partyId, d.id, replay))).toEqual(result);
    expect(await frozen()).toEqual(before);
  });

  it("rolls back answer, guests and moved ticks when draft conversion fails after the move", async () => {
    const p = await party(),
      d = await draft(p);
    const ask = await draftCommand(p, d, "fire", {
      party: guests,
      ticks: [{ line: { kind: "draft", id: d.lines[0]!.id }, guestIndex: 0 }],
    });
    const before = await frozen();
    const move = VENUE_SERVICE.moveAllergyDraftTicks;
    const probe = vi
      .spyOn(VENUE_SERVICE, "moveAllergyDraftTicks")
      .mockImplementation(async (...args) => {
        await move(...args);
        const saved = await VENUE_SERVICE.readPartyAllergy(args[0], p.partyId);
        expect(saved.ticks).toHaveLength(1);
        expect(saved.ticks[0]!.draftLineId).toBeNull();
        expect(saved.ticks[0]!.workingLineId).not.toBeNull();
        throw new AppError("allergy.invalid", { field: "probe_after_move" });
      });
    try {
      await expect(
        inTx(v, (tx) => submitDraft(tx, v.cfg, p.partyId, d.id, ask)),
      ).rejects.toMatchObject({
        code: "allergy.invalid",
        params: { field: "probe_after_move" },
      });
      expect(await frozen()).toEqual(before);
    } finally {
      probe.mockRestore();
    }
  });

  for (const path of ["draft", "direct"] as const) {
    it(`${path} records the guest assignment before any kitchen output and rolls it back with output failure`, async () => {
      const p = await party(),
        d = path === "draft" ? await draft(p) : null;
      const allergy: AllergyPatch = {
        party: guests,
        ticks: [
          {
            line:
              d === null
                ? { kind: "submitted", groupIndex: 0, lineIndex: 0 }
                : { kind: "draft", id: d.lines[0]!.id },
            guestIndex: 1,
          },
        ],
      };
      const ask =
        d === null
          ? await directCommand(p, "fire", allergy)
          : await draftCommand(p, d, "fire", allergy);
      const before = await frozen();
      const probe = vi.spyOn(orderWrites, "fireLines").mockImplementation(async (tx) => {
        const saved = await VENUE_SERVICE.readPartyAllergy(tx, p.partyId);
        expect(saved.answer).toBe("allergies");
        expect(saved.ticks).toHaveLength(1);
        expect(saved.ticks[0]!.guestId).toBe(saved.guests[1]!.id);
        expect(saved.ticks[0]!.workingLineId).not.toBeNull();
        throw new AppError("allergy.invalid", { field: "probe_before_output" });
      });
      try {
        await expect(
          inTx(v, (tx) =>
            d === null
              ? submitGroups(tx, v.cfg, p.partyId, ask as Awaited<ReturnType<typeof directCommand>>)
              : submitDraft(
                  tx,
                  v.cfg,
                  p.partyId,
                  d.id,
                  ask as Awaited<ReturnType<typeof draftCommand>>,
                ),
          ),
        ).rejects.toMatchObject({
          code: "allergy.invalid",
          params: { field: "probe_before_output" },
        });
        expect(await frozen()).toEqual(before);
      } finally {
        probe.mockRestore();
      }
    });

    it(`${path} refuses foreign or ineligible tick targets without retaining the proposed answer`, async () => {
      const p = await party(),
        other = await party(),
        d = await draft(p, 2),
        foreign = await draft(other);
      for (const line of path === "draft"
        ? [
            { kind: "draft" as const, id: foreign.lines[0]!.id },
            { kind: "draft" as const, id: d.lines[1]!.id },
          ]
        : [
            { kind: "submitted" as const, groupIndex: 0, lineIndex: 1 },
            { kind: "draft" as const, id: foreign.lines[0]!.id },
          ]) {
        const allergy: AllergyPatch = { party: guests, ticks: [{ line, guestIndex: 0 }] };
        const ask =
          path === "direct"
            ? await directCommand(p, "hold", allergy)
            : {
                ...(await draftCommand(p, d, "hold", allergy)),
                groups: [{ release: "hold" as const, lineIds: [d.lines[0]!.id] }],
              };
        const before = await frozen();
        await expect(
          inTx(v, (tx) =>
            path === "direct"
              ? submitGroups(tx, v.cfg, p.partyId, ask as Awaited<ReturnType<typeof directCommand>>)
              : submitDraft(
                  tx,
                  v.cfg,
                  p.partyId,
                  d.id,
                  ask as Awaited<ReturnType<typeof draftCommand>>,
                ),
          ),
        ).rejects.toMatchObject({ code: "allergy.invalid", params: { field: "ticks.0.line" } });
        expect(await frozen()).toEqual(before);
      }
    });
  }

  for (const path of ["draft", "direct"] as const) {
    it.each(["pricing", "editor", "payment"] as const)(
      `${path} rolls back proposed answers and ticks on %s refusal`,
      async (cause) => {
        const p = await party(),
          d = path === "draft" ? await draft(p) : null;
        const allergy: AllergyPatch = {
          party: guests,
          ticks: [
            {
              line:
                d === null
                  ? { kind: "submitted", groupIndex: 0, lineIndex: 0 }
                  : { kind: "draft", id: d.lines[0]!.id },
              guestIndex: 0,
            },
          ],
        };
        const ask =
          d === null
            ? await directCommand(p, "fire", allergy)
            : await draftCommand(p, d, "fire", allergy);
        if (cause === "payment")
          await v.db
            .update(workingOrders)
            .set({ paymentAttemptAt: "2026-10-19T12:00:00.000Z" })
            .where(eq(workingOrders.id, p.tabId));
        if (cause === "editor") ask.expectedEdit.editorVersion++;
        if (cause === "pricing") {
          if (d !== null)
            await v.db
              .update(orderDraftLines)
              .set({ quantity: 500 })
              .where(eq(orderDraftLines.id, d.lines[0]!.id));
          else
            (ask as Awaited<ReturnType<typeof directCommand>>).groups[0]!.lines[0]!.quantity =
              "0.5";
        }
        const before = await frozen();
        await expect(
          inTx(v, (tx) =>
            d === null
              ? submitGroups(tx, v.cfg, p.partyId, ask as Awaited<ReturnType<typeof directCommand>>)
              : submitDraft(
                  tx,
                  v.cfg,
                  p.partyId,
                  d.id,
                  ask as Awaited<ReturnType<typeof draftCommand>>,
                ),
          ),
        ).rejects.toMatchObject({
          code:
            cause === "pricing"
              ? "quantity.invalid"
              : cause === "payment"
                ? "order.payment_in_flight"
                : "draft.out_of_date",
        });
        expect(await frozen()).toEqual(before);
      },
    );
  }

  it("reticks a recalled parent through its preview reference while retaining its working identity", async () => {
    const p = await party(),
      first = await directCommand(p, "hold", { party: guests, ticks: [] });
    await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, first));
    await inTx(v, (tx) => writeEditSentLines(tx, true));
    const [source] = await v.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, p.tabId));
    const expectedPartyRevision = await revisionOf(v, p.partyId);
    const recalled = await inTx(v, async (tx) =>
      recallToDraft(tx, v.cfg, p.partyId, source!.id, {
        submissionId: randomUUID(),
        expectedPartyRevision,
        operatorId: OPERATOR,
        expectedEdit: await readBillEditState(tx, p.tabId),
      }),
    );
    const preview = await inTx(v, (tx) =>
      readAllergySendView(tx, v.cfg, p.partyId, {
        kind: "draft",
        draftId: recalled.draft.id,
        lineIds: [recalled.draft.lines[0]!.id],
      }),
    );
    expect(preview.dishes.map((d) => d.line)).toEqual([{ kind: "working", id: source!.id }]);
    const ask = await draftCommand(p, recalled.draft, "fire", {
      ticks: [{ line: preview.dishes[0]!.line, guestIndex: 1 }],
    });
    await inTx(v, (tx) => submitDraft(tx, v.cfg, p.partyId, recalled.draft.id, ask));
    const saved = await snapshot(p);
    expect(saved.ticks).toEqual([
      { guestId: saved.guests[1]!.id, draftLineId: null, workingLineId: source!.id },
    ]);
    expect(
      await v.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, p.tabId)),
    ).toHaveLength(1);
  });

  it("considers unticked held dishes even without HOLD printing and can join more dishes without resetting the answer", async () => {
    const p = await party(),
      ask = await directCommand(p, "hold", { party: guests, ticks: [] });
    const first = await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, ask));
    expect(
      await v.db
        .select({ holdPrintedAt: orderGroups.holdPrintedAt })
        .from(orderGroups)
        .where(eq(orderGroups.id, first.groups[0]!.id)),
    ).toEqual([{ holdPrintedAt: null }]);
    const current = await snapshot(p);
    expect(current.ticks).toEqual([]);
    const view = await inTx(v, (tx) => readPartyAllergyView(tx, v.cfg, p.partyId));
    expect(view.dishes.map((d) => d.offeredBefore)).toEqual([true]);
    const join = {
      ...(await directCommand(p, "hold", {
        ticks: [
          { line: { kind: "submitted" as const, groupIndex: 0, lineIndex: 0 }, guestIndex: 0 },
        ],
      })),
      joinGroupId: first.groups[0]!.id,
    };
    await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, join));
    const after = await snapshot(p);
    expect(after.guests).toEqual(current.guests);
    expect(after.ticks).toHaveLength(1);
    expect(
      (await inTx(v, (tx) => readPartyAllergyView(tx, v.cfg, p.partyId))).dishes.map(
        (d) => d.offeredBefore,
      ),
    ).toEqual([true, true]);
  });

  it("assigns direct parents before output when extra rows and reversed insert results separate them", async () => {
    const p = await party();
    const products = await inTx(v, async (tx) => {
      const cat = await createCatalogue(tx, {
        name: `Extra catalogue ${randomUUID().slice(0, 8)}`,
      });
      const category = await createCategory(tx, {
        name: `Extra category ${randomUUID().slice(0, 8)}`,
      });
      const make = (name: string) =>
        createProduct(tx, {
          catalogueId: cat.id,
          categoryId: category.id,
          name,
          customerName: { es: `${name} customer` },
          kitchenName: `${name} kitchen`,
          pricingUnit: "each",
          unitPrice: "2.00",
          vatClass: "general",
        });
      const dish = await make("Soup"),
        extra = await make("Egg garnish");
      const list = await createExtraList(
        tx,
        {
          name: "Garnishes",
          customerName: null,
          kitchenName: null,
          minPicks: 0,
          maxPicks: 1,
          active: true,
          items: [{ productId: extra.id, maxQuantity: 1, preselected: false, price: "1.00" }],
        },
        "es-ES",
      );
      await writeProductModifiers(tx, dish.id, [{ kind: "extras", id: list.id }]);
      await assignCatalogueToLocation(tx, v.cfg.locationId, cat.id);
      const offers = await offerProducts(tx, v.cfg, {
        zone: { zoneId: v.tables.zoneId },
        orderStart: "table",
      });
      await publishWorkingMenu(tx, offers.menuId);
      return { dish, extra, list, menuItemId: offers.offerFor(dish.id) };
    });
    const ask = {
      ...(await directCommand(p, "fire", {
        party: guests,
        ticks: [{ line: { kind: "submitted", groupIndex: 0, lineIndex: 1 }, guestIndex: 1 }],
      })),
      groups: [
        {
          release: "fire" as const,
          lines: [
            {
              menuItemId: products.menuItemId,
              quantity: "1",
              extras: [
                {
                  listId: products.list.id,
                  picks: [{ productId: products.extra.id, quantity: 1 }],
                },
              ],
            },
            { menuItemId: products.menuItemId, quantity: "2" },
          ],
        },
      ],
    };
    const insert = orderWrites.insertTabRound;
    const probe = vi
      .spyOn(orderWrites, "insertTabRound")
      .mockImplementation(async (...args) => (await insert(...args)).reverse());
    try {
      await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, ask));
    } finally {
      probe.mockRestore();
    }
    const rows = await v.db
      .select()
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, p.tabId))
      .orderBy(workingOrderLines.lineNo);
    expect(rows.map((r) => [r.quantity, r.parentLineId === null])).toEqual([
      [1000, true],
      [1000, false],
      [2000, true],
    ]);
    const saved = await snapshot(p);
    expect(saved.ticks).toEqual([
      { guestId: saved.guests[1]!.id, draftLineId: null, workingLineId: rows[2]!.id },
    ]);
  });

  it.each([
    [null, "allergy"],
    [{ ticks: null }, "ticks"],
    [{ ticks: [], party: null }, "party"],
    [{ ticks: [], party: { answer: "allergies", guests: null } }, "party"],
    [{ ticks: [], party: { answer: "allergies", guests: [null] } }, "guests.0"],
    [
      {
        ticks: [],
        party: {
          answer: "allergies",
          guests: [{ id: "wrong", who: "Alex", allergens: { milk: {} }, note: null }],
        },
      },
      "guests.0.id",
    ],
    [{ ticks: [null] }, "ticks.0.line"],
    [
      { ticks: [{ line: { kind: "submitted", groupIndex: -1, lineIndex: 0 }, guestIndex: null }] },
      "ticks.0.line",
    ],
    [{ ticks: [{ line: { kind: "working", id: "wrong" }, guestIndex: null }] }, "ticks.0.line"],
  ])("refuses malformed allergy patch %j without writes", async (allergy, field) => {
    const p = await party(),
      ask = { ...(await directCommand(p)), allergy: allergy as AllergyPatch };
    const before = await frozen();
    await expect(inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, ask))).rejects.toMatchObject({
      code: "allergy.invalid",
      params: { field },
    });
    expect(await frozen()).toEqual(before);
  });

  it("normalizes existing guest ids in direct-submit replay without creating another guest", async () => {
    const p = await party();
    await inTx(v, (tx) => VENUE_SERVICE.writePartyAllergy(tx, p.partyId, guests, OPERATOR));
    const original = await snapshot(p);
    const patch: AllergyPatch = {
      party: {
        answer: "allergies",
        guests: original.guests.map((g) => ({ ...g, id: g.id.toUpperCase() })),
      },
      ticks: [],
    };
    const ask = await directCommand(p, "hold", patch);
    const result = await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, ask));
    const before = await frozen();
    const replay = {
      ...ask,
      allergy: { ...patch, party: { answer: "allergies" as const, guests: original.guests } },
    };
    expect(await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, replay))).toEqual(result);
    expect(await frozen()).toEqual(before);
    expect((await snapshot(p)).guests.map((g) => g.id)).toEqual(original.guests.map((g) => g.id));
  });

  it("allows an explicit allergies answer with no guests and later sends without a new patch", async () => {
    const p = await party();
    const first = await directCommand(p, "hold", {
      party: { answer: "allergies", guests: [] },
      ticks: [],
    });
    await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, first));
    const again = await directCommand(p, "fire");
    await inTx(v, (tx) => submitGroups(tx, v.cfg, p.partyId, again));
    expect(await snapshot(p)).toMatchObject({
      answer: "allergies",
      guests: [],
      ticks: [],
      revision: again.expectedPartyRevision + 1,
    });
  });
});
