import { observedDraftCommandBody } from "./testing/draft-command-fixture.js";
import { readBillEditState } from "./bill-editing.js";
import { observedGroupSender } from "./testing/group-composition-fixture.js";
import { saveDraftForTest as saveDraft } from "./testing/draft-command-fixture.js";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import {
  orderDraftRecalledLines,
  parties,
  printJobs,
  products,
  ticketItems,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  createExtraList,
  createOptionList,
  createProduct,
  sectionMembers,
  setProductVariants,
  writeProductModifiers,
} from "@waitron/catalogue";
import { adjustments, createAdjustmentReason } from "@waitron/adjustments";
import { workingLineContexts } from "@waitron/venue-service";
import { decimal } from "@waitron/shared";
import { applyAdjustment } from "./adjustments-apply.js";
import { type BillDraftSnapshot, type Draft } from "./order-drafts.js";
import {
  inTx,
  provisionBillVenue,
  send as rawGroupSend,
  type BillVenue,
} from "./testing/bill-venue.js";
import { createTable } from "./testing/live-table.js";
import { offerProducts } from "./testing/zone-offers.js";
import { republishMenus } from "./testing/publish-menu.js";
import { VENUE_SERVICE } from "./modules.js";
import { readStoredOrder } from "./working-order.js";
import { receiptLines } from "./receipt-adjustments.js";
import { groupByParent } from "./receipt-lines.js";
import { loginWithPin } from "@waitron/identity";
import { SESSION_COOKIE } from "./till-session.js";

let venue: BillVenue;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
  },
});
async function call(method: string, path: string, body?: unknown) {
  return send(
    venue.app,
    venue.cookie,
    method,
    path,
    await observedDraftCommandBody(venue.db, method, path, body),
  );
}
async function command(partyId: string) {
  const [party] = await venue.db.select().from(parties).where(eq(parties.id, partyId));
  return { submissionId: randomUUID(), expectedPartyRevision: party!.revision };
}
async function setup(withVariant = false) {
  const seeded = await inTx(venue, async (tx) => {
    const [existing] = await tx.select().from(products).where(eq(products.name, "Tarta"));
    const product = async (name: string, price: string) =>
      createProduct(tx, {
        catalogueId: existing!.catalogueId,
        categoryId: null,
        name: `${name} staff ${randomUUID()}`,
        customerName: { es: `${name} customer` },
        kitchenName: `${name} kitchen`,
        pricingUnit: "each",
        unitPrice: price,
        vatClass: "general",
      });
    const dish = await product("Recall dish", "18.00");
    const cheese = await product("Cheese", "9.00");
    const bacon = await product("Bacon", "8.00");
    const options = await createOptionList(
      tx,
      {
        name: "Cooking staff",
        customerName: { es: "Cooking customer" },
        kitchenName: "Cooking kitchen",
        defaultLabelId: null,
        active: true,
        labels: ["Rare", "Well done"].map((name) => ({
          name: `${name} staff`,
          customerName: { es: `${name} customer` },
          kitchenName: `${name} kitchen`,
          available: true,
        })),
      },
      venue.cfg.locale,
    );
    const extras = await createExtraList(
      tx,
      {
        name: "Toppings staff",
        customerName: { es: "Toppings customer" },
        kitchenName: "Toppings kitchen",
        minPicks: 0,
        maxPicks: null,
        active: true,
        items: [cheese, bacon].map((item, i) => ({
          productId: item.id,
          maxQuantity: 2,
          preselected: false,
          price: i === 0 ? "1.00" : "2.00",
        })),
      },
      venue.cfg.locale,
    );
    await writeProductModifiers(tx, dish.id, [
      { kind: "options", id: options.id },
      { kind: "extras", id: extras.id },
    ]);
    const variant = withVariant
      ? (
          await setProductVariants(
            tx,
            dish.id,
            [
              {
                name: "Large staff",
                customerName: { es: "Large customer" },
                kitchenName: "Large kitchen",
                image: null,
                unitPrice: "18.00",
                available: true,
              },
            ],
            venue.cfg.locale,
          )
        )[0]
      : undefined;
    const offers = await offerProducts(tx, venue.cfg, {
      zone: { zoneId: venue.zoneId },
      orderStart: "table",
    });
    const table = await createTable(tx, venue.cfg, {
      label: `M-${randomUUID()}`,
      zoneId: venue.zoneId,
    });
    return {
      dish,
      cheese,
      bacon,
      options,
      extras,
      table,
      variant,
      menuItemId: offers.offerFor(dish.id),
    };
  });
  const seated = await call("POST", `/api/tables/${seeded.table.id}/seat`, {});
  expect(seated.status, JSON.stringify(seated.json)).toBe(200);
  const { partyId, tabId } = seated.json as unknown as { partyId: string; tabId: string };
  const rare = [{ listId: seeded.options.id, labelId: seeded.options.labels[0]!.id }];
  const cheesePicks = [
    { listId: seeded.extras.id, picks: [{ productId: seeded.cheese.id, quantity: 1 }] },
  ];
  const sent = await call("POST", `/api/parties/${partyId}/groups`, {
    ...(await command(partyId)),
    groups: [
      {
        release: "hold",
        lines: [
          {
            menuItemId: seeded.menuItemId,
            variantId: seeded.variant?.id,
            quantity: "2",
            options: rare,
            extras: cheesePicks,
          },
        ],
      },
    ],
  });
  expect(sent.status, JSON.stringify(sent.json)).toBe(200);
  const rows = await venue.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, tabId));
  const parent = rows.find((line) => line.parentLineId === null)!;
  await inTx(venue, async (tx) => {
    const reason = await createAdjustmentReason(tx, {
      name: `Modifier discount ${randomUUID()}`,
      names: {},
      kind: "comp",
      actions: ["discount_percent"],
      maxPercentBp: null,
      maxAmount: null,
      applyRoles: ["staff", "supervisor", "manager", "admin"],
      approverRoles: ["staff", "supervisor", "manager", "admin"],
      noteRequired: false,
    });
    const [bill] = await tx.select().from(workingOrders).where(eq(workingOrders.id, tabId));
    await applyAdjustment(
      tx,
      venue.cfg,
      {
        expectedEdit: await readBillEditState(tx, tabId),
        orderId: tabId,
        expectedRevision: bill!.revision,
        submissionId: randomUUID(),
        lineId: parent.id,
        reasonId: reason.id,
        action: "discount_percent",
        percentBp: 2500,
        note: null,
        operatorId: venue.adminId,
      },
      venue.cfg.locale,
    );
  });
  const recalled = await call(
    "POST",
    `/api/parties/${partyId}/lines/${parent.id}/recall`,
    await command(partyId),
  );
  expect(recalled.status).toBe(200);
  const { draft } = recalled.json as unknown as { draft: Draft };
  return { ...seeded, partyId, tabId, parent, draft, rare, cheesePicks };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function save(p: Fixture, patch: Record<string, unknown>, draft = p.draft) {
  return call("PUT", `/api/parties/${p.partyId}/drafts`, {
    billId: p.tabId,
    draftId: draft.id,
    revision: draft.revision,
    lines: [{ ...draft.lines[0]!, ...patch }],
  });
}
async function family(p: Fixture) {
  return venue.db
    .select()
    .from(workingOrderLines)
    .where(eq(workingOrderLines.workingOrderId, p.tabId))
    .orderBy(workingOrderLines.lineNo);
}
async function frozen(p: Fixture) {
  return {
    lines: await family(p),
    adjustments: await venue.db.select().from(adjustments).orderBy(adjustments.id),
    sources: await venue.db
      .select()
      .from(orderDraftRecalledLines)
      .orderBy(orderDraftRecalledLines.id),
    items: await venue.db.select().from(ticketItems).orderBy(ticketItems.id),
    jobs: await venue.db.select().from(printJobs).orderBy(printJobs.id),
    contexts: await venue.db
      .select()
      .from(workingLineContexts)
      .orderBy(workingLineContexts.workingOrderLineId),
  };
}

describe("recalled modifier edits", () => {
  it.each([false, true])(
    "prices newly selected extras for two sources from one shared offer snapshot, fresh=%s",
    async (fresh) => {
      const p = await setup();
      const added = await call("POST", `/api/parties/${p.partyId}/groups`, {
        ...(await command(p.partyId)),
        groups: [
          {
            release: "hold",
            lines: [
              { menuItemId: p.menuItemId, quantity: "2", options: p.rare, extras: p.cheesePicks },
            ],
          },
        ],
      });
      expect(added.status, JSON.stringify(added.json)).toBe(200);
      const second = (await family(p)).find(
        (row) => row.parentLineId === null && row.id !== p.parent.id,
      )!;
      const recalled = await call(
        "POST",
        `/api/parties/${p.partyId}/lines/${second.id}/recall`,
        await command(p.partyId),
      );
      expect(recalled.status).toBe(200);
      const { draft } = recalled.json as unknown as { draft: Draft };
      expect(draft.lines).toHaveLength(2);
      const list = vi.spyOn(VENUE_SERVICE, "listZoneOffers");
      try {
        const answer = await call("PUT", `/api/parties/${p.partyId}/drafts`, {
          billId: p.tabId,
          draftId: draft.id,
          revision: draft.revision,
          lines: [
            ...draft.lines.map((line) => ({
              ...line,
              extras: [
                {
                  listId: p.extras.id,
                  picks: [
                    { productId: p.cheese.id, quantity: 1 },
                    { productId: p.bacon.id, quantity: 1 },
                  ],
                },
              ],
            })),
            ...(fresh ? [{ menuItemId: venue.offerFor("Croquetas"), quantity: "1" }] : []),
          ],
        });
        expect(answer.status, JSON.stringify(answer.json)).toBe(200);
        expect(
          (answer.json as unknown as BillDraftSnapshot).draft!.lines.map(
            (line) => line.source?.netAmount,
          ),
        ).toEqual(["32.50", "42.00", ...(fresh ? [undefined] : [])]);
        expect(
          (await family(p))
            .filter((row) => row.productId === p.bacon.id)
            .map((row) => ({
              parent: row.parentLineId,
              price: row.unitPriceGross,
              total: row.lineTotal,
            })),
        ).toEqual([
          { parent: p.parent.id, price: 200, total: 400 },
          { parent: second.id, price: 200, total: 400 },
        ]);
        const receipt = await inTx(venue, async (tx) => {
          const { gross, identities } = await readStoredOrder(tx, p.tabId);
          return receiptLines(tx, p.tabId, gross, identities);
        });
        expect(
          groupByParent(receipt.lines).map(({ dish, options }) => [
            dish.gross,
            ...options.map((line) => line.gross),
          ]),
        ).toEqual([
          ["27.00", "1.50", "4.00"],
          ["36.00", "2.00", "4.00"],
        ]);
        expect(list).toHaveBeenCalledTimes(1);
      } finally {
        list.mockRestore();
      }
    },
  );

  it.each([false, true])(
    "changes an option after its offer is withdrawn, variant=%s",
    async (variant) => {
      const p = await setup(variant);
      await inTx(venue, async (tx) => {
        await tx.delete(sectionMembers).where(eq(sectionMembers.productId, p.dish.id));
        await republishMenus(tx);
      });
      const before = await frozen(p);
      const answer = await save(p, {
        options: [{ listId: p.options.id, labelId: p.options.labels[1]!.id }],
      });
      expect(answer.status, JSON.stringify(answer.json)).toBe(200);
      const after = await frozen(p);
      expect(after.lines[0]!.id).toBe(p.parent.id);
      expect(after.lines[0]!.unitPriceGross).toBe(1350);
      expect(after.lines[0]!.optionSnapshots[0]!.labelKitchenName).toBe("Well done kitchen");
      expect(after.lines.slice(1)).toEqual(before.lines.slice(1));
      expect(after.adjustments).toEqual(before.adjustments);
      expect(after.sources).toEqual(before.sources);
    },
  );

  it.each(["unavailable", "limit", "option"] as const)(
    "refuses a new %s choice atomically",
    async (kind) => {
      const p = await setup();
      if (kind === "unavailable") {
        await venue.db
          .update(products)
          .set({ available: false })
          .where(eq(products.id, p.bacon.id));
        await inTx(venue, republishMenus);
      }
      const before = await frozen(p);
      const answer = await save(
        p,
        kind === "option"
          ? { options: [] }
          : {
              extras: [
                {
                  listId: p.extras.id,
                  picks: [
                    { productId: p.cheese.id, quantity: 1 },
                    { productId: p.bacon.id, quantity: kind === "limit" ? 3 : 1 },
                  ],
                },
              ],
            },
      );
      expect(answer.status).toBe(400);
      expect(answer.json).toMatchObject({
        code: {
          unavailable: "extras.invalid",
          limit: "extras.limit_exceeded",
          option: "options.label_required",
        }[kind],
      });
      expect(await frozen(p)).toEqual(before);
      const read = await call("GET", `/api/parties/${p.partyId}/drafts`);
      expect((read.json as unknown as { drafts: Draft[] }).drafts[0]!.revision).toBe(
        p.draft.revision,
      );
    },
  );

  it("keeps an unavailable recorded extra and unchanged option without advancing bill revisions", async () => {
    const p = await setup();
    await venue.db
      .update(products)
      .set({ available: false, unitPrice: 9900 })
      .where(eq(products.id, p.cheese.id));
    await inTx(venue, republishMenus);
    const before = await frozen(p);
    const [bill] = await venue.db.select().from(workingOrders).where(eq(workingOrders.id, p.tabId));
    const party = await command(p.partyId);
    const answer = await save(p, { options: p.rare, extras: p.cheesePicks });
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect(await frozen(p)).toEqual(before);
    const [after] = await venue.db
      .select()
      .from(workingOrders)
      .where(eq(workingOrders.id, p.tabId));
    expect(after).toEqual(bill);
    expect((await command(p.partyId)).expectedPartyRevision).toBe(party.expectedPartyRevision);
  });

  it("scales kept extras at their stored discount while pricing an addition at the increased quantity", async () => {
    const p = await setup();
    const before = await frozen(p);
    const answer = await save(p, {
      quantity: "3",
      extras: [
        {
          listId: p.extras.id,
          picks: [
            { productId: p.cheese.id, quantity: 1 },
            { productId: p.bacon.id, quantity: 1 },
          ],
        },
      ],
    });
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect((answer.json as unknown as BillDraftSnapshot).draft!.lines[0]).toMatchObject({
      quantity: "3.000",
      source: { netAmount: "48.75" },
    });
    const after = await family(p);
    expect(
      after.map((row) => ({
        price: row.unitPriceGross,
        quantity: row.quantity,
        total: row.lineTotal,
      })),
    ).toEqual([
      { price: 1350, quantity: 3000, total: 4050 },
      { price: 75, quantity: 3000, total: 225 },
      { price: 200, quantity: 3000, total: 600 },
    ]);
    expect(after.slice(0, 2).map((row) => row.id)).toEqual(before.lines.map((row) => row.id));
    expect(await venue.db.select().from(adjustments).orderBy(adjustments.id)).toEqual(
      before.adjustments,
    );
  });

  it("removes a recorded extra while keeping the original dish price and adjustment history", async () => {
    const p = await setup();
    const before = await frozen(p);
    const answer = await save(p, { extras: [] });
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect((answer.json as unknown as BillDraftSnapshot).draft!.lines[0]).toMatchObject({
      source: { netAmount: "27.00", extras: [] },
    });
    const after = await frozen(p);
    expect(after.lines).toEqual([before.lines[0]]);
    expect(after.adjustments).toEqual(before.adjustments);
    expect(after.sources).toEqual(before.sources);
    expect(after.jobs).toEqual(before.jobs);
    expect(after.items).toEqual(before.items);
  });

  it.each(["options", "extras"] as const)(
    "refuses %s edits without retained choice metadata and rolls back the draft",
    async (kind) => {
      const p = await setup();
      await venue.db
        .delete(workingLineContexts)
        .where(eq(workingLineContexts.workingOrderLineId, p.parent.id));
      const before = await frozen(p);
      const answer = await save(p, { [kind]: [] });
      expect(answer.status).toBe(400);
      expect(answer.json).toMatchObject({
        code: "management.request_invalid",
        params: { field: "lines.0.sourceLineId" },
      });
      expect(await frozen(p)).toEqual(before);
      const read = await call("GET", `/api/parties/${p.partyId}/drafts`);
      expect((read.json as unknown as { drafts: Draft[] }).drafts[0]!.revision).toBe(
        p.draft.revision,
      );
    },
  );

  it("changes an option on an unavailable discounted dish without repricing its family", async () => {
    const p = await setup();
    await venue.db
      .update(products)
      .set({ available: false, unitPrice: 9900 })
      .where(eq(products.id, p.dish.id));
    await inTx(venue, republishMenus);
    const before = await frozen(p);
    const answer = await save(p, {
      options: [{ listId: p.options.id, labelId: p.options.labels[1]!.id }],
    });
    expect(answer.status, JSON.stringify(answer.json)).toBe(200);
    expect((answer.json as unknown as BillDraftSnapshot).draft!.lines[0]).toMatchObject({
      source: {
        netAmount: "28.50",
        line: {
          id: p.parent.id,
          unitPriceGross: "13.50",
          listUnitPriceGross: "18.00",
          optionSnapshots: [
            { labelName: { es: "Well done staff" }, labelKitchenName: "Well done kitchen" },
          ],
        },
      },
    });
    const after = await frozen(p);
    expect(after).toEqual({
      ...before,
      lines: before.lines.map((line) =>
        line.id === p.parent.id
          ? {
              ...line,
              optionSnapshots: [
                {
                  listName: { es: "Cooking staff" },
                  listCustomerName: { es: "Cooking customer" },
                  listKitchenName: "Cooking kitchen",
                  labelName: { es: "Well done staff" },
                  labelCustomerName: { es: "Well done customer" },
                  labelKitchenName: "Well done kitchen",
                },
              ],
            }
          : line,
      ),
    });
  });

  it.each([false, true])(
    "adds only a newly priced extra to an unavailable dish, variant=%s",
    async (variant) => {
      const p = await setup(variant);
      await venue.db
        .update(products)
        .set({ available: false, unitPrice: 9900 })
        .where(eq(products.id, p.dish.id));
      await inTx(venue, republishMenus);
      const before = await frozen(p);
      const picks = [
        {
          listId: p.extras.id,
          picks: [
            { productId: p.cheese.id, quantity: 1 },
            { productId: p.bacon.id, quantity: 1 },
          ],
        },
      ];
      const answer = await save(p, { extras: picks });
      expect(answer.status, JSON.stringify(answer.json)).toBe(200);
      expect((answer.json as unknown as BillDraftSnapshot).draft!.lines[0]).toMatchObject({
        source: {
          netAmount: "32.50",
          extras: [
            { id: before.lines[1]!.id, unitPriceGross: "0.75" },
            { productId: p.bacon.id, quantity: "2.000", unitPriceGross: "2.00" },
          ],
        },
      });
      const after = await frozen(p);
      expect(after.lines.slice(0, 2)).toEqual(before.lines);
      expect(after.lines[2]).toMatchObject({
        parentLineId: p.parent.id,
        groupId: p.parent.groupId,
        creditedTo: p.parent.creditedTo,
        unitPriceGross: 200,
        lineTotal: 400,
        listUnitPriceGross: null,
      });
      expect(after.adjustments).toEqual(before.adjustments);
      expect(after.sources).toEqual(before.sources);
      expect(after.items).toEqual(before.items);
      expect(after.jobs).toEqual(before.jobs);
      expect(after.contexts.filter((row) => row.workingOrderLineId !== after.lines[2]!.id)).toEqual(
        before.contexts,
      );
      expect(
        after.contexts.find((row) => row.workingOrderLineId === after.lines[2]!.id),
      ).toMatchObject({ menuItemId: p.menuItemId });
      const again = await save(
        p,
        { extras: picks },
        (answer.json as unknown as BillDraftSnapshot).draft!,
      );
      expect(again.status).toBe(200);
      expect(await frozen(p)).toEqual(after);
      const draft = (again.json as unknown as BillDraftSnapshot).draft!;
      const request = {
        ...(await command(p.partyId)),
        draftRevision: draft.revision,
        groups: [{ release: "fire", lineIds: [draft.lines[0]!.id] }],
      };
      const sent = await call(
        "POST",
        `/api/parties/${p.partyId}/drafts/${draft.id}/submit`,
        request,
      );
      expect(sent.status, JSON.stringify(sent.json)).toBe(200);
      const released = await family(p);
      expect(released.map((row) => ({ ...row, groupId: null, sentAt: null }))).toEqual(
        after.lines.map((row) => ({ ...row, groupId: null, sentAt: null })),
      );
      expect(await venue.db.select().from(adjustments).orderBy(adjustments.id)).toEqual(
        before.adjustments,
      );
      const replay = await call(
        "POST",
        `/api/parties/${p.partyId}/drafts/${draft.id}/submit`,
        request,
      );
      expect(replay.json).toEqual(sent.json);
      expect(await family(p)).toEqual(released);
      expect(
        await venue.db
          .select()
          .from(orderDraftRecalledLines)
          .where(eq(orderDraftRecalledLines.draftId, draft.id)),
      ).toEqual([]);
    },
  );

  it("rolls back a newly priced extra that exceeds the simplified-invoice ceiling", async () => {
    const p = await setup();
    const before = await frozen(p);
    await expect(
      inTx(venue, (tx) =>
        saveDraft(
          tx,
          { ...venue.cfg, simplifiedInvoiceLimit: decimal("30.00") },
          p.partyId,
          venue.operatorId,
          {
            billId: p.tabId,
            draftId: p.draft.id,
            revision: p.draft.revision,
            lines: [
              {
                ...p.draft.lines[0]!,
                extras: [
                  {
                    listId: p.extras.id,
                    picks: [
                      { productId: p.cheese.id, quantity: 1 },
                      { productId: p.bacon.id, quantity: 1 },
                    ],
                  },
                ],
              },
            ],
          },
        ),
      ),
    ).rejects.toMatchObject({
      code: "sale.total_exceeds_simplified_limit",
      params: { total: "32.50", limit: "30.00" },
    });
    expect(await frozen(p)).toEqual(before);
  });
});

const send = observedGroupSender(() => venue.db, rawGroupSend);

describe("mixed New order persistence through authenticated requests", () => {
  it.each([false, true])(
    "keeps fresh placement and a discounted recalled family through reread, takeover and partial send, variant=%s",
    async (variant) => {
      const p = await setup(variant);
      const before = await frozen(p);
      const path = `/api/parties/${p.partyId}/drafts`;
      const firstRead = await call("GET", path);
      expect(firstRead.status).toBe(200);
      const edit = (firstRead.json.billEdits as BillDraftSnapshot["edit"][]).find(
        (entry) => entry.billId === p.tabId,
      )!;
      const places = [
        { slot: 0, joinGroupId: null, afterGroupId: null },
        { slot: 2, joinGroupId: null, afterGroupId: p.parent.groupId },
        { slot: 0, joinGroupId: p.parent.groupId, afterGroupId: null },
      ];
      const saved = await call("PUT", path, {
        billId: p.tabId,
        draftId: p.draft.id,
        revision: p.draft.revision,
        expectedEdit: edit,
        lines: [
          { menuItemId: venue.offerFor("Caña"), quantity: "2", ...places[0] },
          {
            menuItemId: venue.offerFor("Pulpo"),
            quantity: "0.375",
            note: "Fresh measured dish",
            ...places[1],
          },
          { ...p.draft.lines[0]!, ...places[2] },
        ],
      });
      expect(saved.status, JSON.stringify(saved.json)).toBe(200);
      const snapshot = saved.json as unknown as BillDraftSnapshot;
      const draft = snapshot.draft!;
      expect(draft.lines).toHaveLength(3);
      expect(draft.lines).toMatchObject(places);
      expect(draft.lines.map((line) => line.quantity)).toEqual(["2.000", "0.375", "2.000"]);
      expect(draft.lines[2]).toMatchObject({
        id: p.draft.lines[0]!.id,
        sourceLineId: p.parent.id,
        source: {
          netAmount: "28.50",
          line: { id: p.parent.id, unitPriceGross: "13.50", quantity: "2.000" },
          extras: [{ quantity: "2.000", unitPriceGross: "0.75" }],
        },
      });
      expect(draft.lines[2]!.source).toEqual(p.draft.lines[0]!.source);
      const afterSave = await frozen(p);
      expect(afterSave).toEqual({
        ...before,
        sources: before.sources.map((row) =>
          row.id === p.draft.lines[0]!.id ? { ...row, position: 3 } : row,
        ),
      });

      const login = await inTx(venue, (tx) =>
        loginWithPin(tx, { deviceId: venue.deviceId, personId: venue.adminId, pin: "1234" }),
      );
      const cookie = `${SESSION_COOKIE}=${login.token}`;
      const freshApp = venue.appAt(venue.clock);
      const readAgain = await rawGroupSend(freshApp, cookie, "GET", path);
      expect(readAgain.status).toBe(200);
      expect(readAgain.json).toEqual({ drafts: [draft], billEdits: [snapshot.edit] });
      expect(await frozen(p)).toEqual(afterSave);

      const taken = await rawGroupSend(freshApp, cookie, "POST", `${path}/${draft.id}/take-over`, {
        submissionId: randomUUID(),
        revision: draft.revision,
        expectedEdit: snapshot.edit,
      });
      expect(taken.status, JSON.stringify(taken.json)).toBe(200);
      const transferred = taken.json as unknown as BillDraftSnapshot;
      expect(transferred.draft).toMatchObject({
        id: draft.id,
        billId: p.tabId,
        ownerId: venue.adminId,
        revision: draft.revision + 1,
        lines: draft.lines,
      });
      expect(transferred.edit).toMatchObject({
        billId: p.tabId,
        editorId: venue.adminId,
        editorVersion: snapshot.edit.editorVersion + 1,
        draftId: draft.id,
        draftRevision: draft.revision + 1,
      });
      expect(await frozen(p)).toEqual(afterSave);

      const selectedRequest = {
        ...(await command(p.partyId)),
        draftRevision: transferred.draft!.revision,
        expectedEdit: transferred.edit,
        groups: [{ release: "fire", lineIds: [draft.lines[0]!.id] }],
      };
      const sent = await rawGroupSend(
        freshApp,
        cookie,
        "POST",
        `${path}/${draft.id}/submit`,
        selectedRequest,
      );
      expect(sent.status, JSON.stringify(sent.json)).toBe(200);
      const partial = sent.json as unknown as BillDraftSnapshot;
      expect(partial.draft).toMatchObject({
        id: draft.id,
        ownerId: venue.adminId,
        revision: transferred.draft!.revision + 1,
        lines: draft.lines.slice(1),
      });
      expect(partial.draft!.lines).toHaveLength(2);
      expect(partial.edit).toMatchObject({
        editorId: venue.adminId,
        editorVersion: transferred.edit.editorVersion,
        draftId: draft.id,
        draftRevision: partial.draft!.revision,
      });
      const stored = await family(p);
      expect(
        stored.filter((line) => line.id === p.parent.id || line.parentLineId === p.parent.id),
      ).toEqual(before.lines);
      expect(
        stored.filter((line) => line.id !== p.parent.id && line.parentLineId !== p.parent.id),
      ).toMatchObject([{ name: "Caña", quantity: 2000, lineTotal: 600 }]);
      expect(stored).toHaveLength(3);
      const afterSend = await frozen(p);
      expect(afterSend.adjustments).toEqual(before.adjustments);
      expect(afterSend.sources).toEqual(afterSave.sources);

      const rereadPartial = await rawGroupSend(venue.app, venue.cookie, "GET", path);
      expect(rereadPartial.status).toBe(200);
      expect(rereadPartial.json).toEqual({ drafts: [partial.draft], billEdits: [partial.edit] });
      expect(
        await rawGroupSend(freshApp, cookie, "POST", `${path}/${draft.id}/submit`, selectedRequest),
      ).toEqual(sent);
      expect(await frozen(p)).toEqual(afterSend);
    },
  );
});
