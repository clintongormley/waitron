import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { products, workingLineContexts } from "@waitron/db";
import type { AllergenMap } from "@waitron/shared";
import {
  createExtraList,
  createProduct,
  setProductVariants,
  updateProduct,
  writeProductModifiers,
} from "@waitron/menu";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { fireGroup, readCurrentOrders } from "./order-groups.js";
import { createOpenOrder, readTabLines, splitLinesWithinOrder } from "./working-order.js";
import { placeOrder, updateOrderLine } from "./testing/order-writer-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { fireAll } from "./testing/serve-line.js";
import { openGroupedCounterOrder } from "./testing/grouped-counter-order.js";
import { republishMenus } from "./testing/publish-menu.js";
import { submitGroups } from "./testing/group-submit-fixture.js";
import {
  OPERATOR,
  inTx,
  revisionOf,
  seatWithNoAllergies,
  setupPartyVenue,
  split,
} from "./testing/party-venue.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

it("keeps the dish declaration from its first send after the product changes", async () => {
  const v = await setupPartyVenue(suite.db);
  await inTx(v, (tx) =>
    updateProduct(tx, v.productId("Burger"), {
      allergens: { milk: {} },
      dietaryDeclarations: ["vegetarian"],
    }),
  );
  const party = await seatWithNoAllergies(v, await v.table("Sent declarations"));
  const expectedPartyRevision = await revisionOf(v, party.partyId);
  await inTx(v, (tx) =>
    submitGroups(tx, v.cfg, party.partyId, {
      submissionId: randomUUID(),
      expectedPartyRevision,
      operatorId: OPERATOR,
      groups: [{ release: "fire", lines: [{ menuItemId: v.item("Burger"), quantity: "1" }] }],
    }),
  );
  await inTx(v, (tx) =>
    updateProduct(tx, v.productId("Burger"), {
      allergens: { eggs: {} },
      dietaryDeclarations: [],
    }),
  );
  const lines = await inTx(v, (tx) => readTabLines(tx, party.tabId));
  expect(lines).toHaveLength(1);
  expect(lines[0]!.sentAt).toEqual(expect.any(String));
  expect(lines[0]!.nutrition).toEqual({
    allergens: { milk: {} },
    dietaryDeclarations: ["vegetarian"],
  });
  const current = await inTx(v, (tx) => readCurrentOrders(tx, party.partyId));
  expect([...current.ungrouped, ...current.groups.flatMap((group) => group.rows)][0]!.sentAt).toBe(
    lines[0]!.sentAt,
  );
  expect(
    [...current.ungrouped, ...current.groups.flatMap((group) => group.rows)].map(
      (row) => row.nutrition,
    ),
  ).toEqual([{ allergens: { milk: {} }, dietaryDeclarations: ["vegetarian"] }]);
});

async function tableDish(release: "fire" | "hold", allergens: AllergenMap | null = { milk: {} }) {
  const v = await setupPartyVenue(suite.db);
  await inTx(v, (tx) =>
    updateProduct(tx, v.productId("Burger"), { allergens, dietaryDeclarations: [] }),
  );
  const party = await seatWithNoAllergies(v, await v.table("Captured declarations"));
  const expectedPartyRevision = await revisionOf(v, party.partyId);
  const sent = await inTx(v, (tx) =>
    submitGroups(tx, v.cfg, party.partyId, {
      submissionId: randomUUID(),
      expectedPartyRevision,
      operatorId: OPERATOR,
      groups: [{ release, lines: [{ menuItemId: v.item("Burger"), quantity: "1" }] }],
    }),
  );
  return { v, party, groupId: sent.groups[0]!.id };
}

it("keeps a held dish live and records its declaration only on release", async () => {
  const { v, party, groupId } = await tableDish("hold");
  await inTx(v, (tx) => updateProduct(tx, v.productId("Burger"), { allergens: { eggs: {} } }));
  const held = await inTx(v, (tx) => readTabLines(tx, party.tabId));
  expect(held[0]!.sentAt).toBeNull();
  expect(held[0]!.nutrition).toEqual({ allergens: { eggs: {} }, dietaryDeclarations: [] });
  const expectedPartyRevision = await revisionOf(v, party.partyId);
  await inTx(v, (tx) =>
    fireGroup(tx, v.cfg, party.partyId, groupId, {
      submissionId: randomUUID(),
      expectedPartyRevision,
      operatorId: OPERATOR,
    }),
  );
  await inTx(v, (tx) => updateProduct(tx, v.productId("Burger"), { allergens: { milk: {} } }));
  const released = await inTx(v, (tx) => readTabLines(tx, party.tabId));
  expect(released[0]!.sentAt).toEqual(expect.any(String));
  expect(released[0]!.nutrition).toEqual({ allergens: { eggs: {} }, dietaryDeclarations: [] });
});

it.each([null, {}] as const)(
  "retains an unreviewed or reviewed-empty first-send declaration (%j)",
  async (allergens) => {
    const { v, party } = await tableDish("fire", allergens);
    await inTx(v, (tx) =>
      updateProduct(tx, v.productId("Burger"), {
        allergens: { eggs: {} },
        dietaryDeclarations: ["vegetarian"],
      }),
    );
    const lines = await inTx(v, (tx) => readTabLines(tx, party.tabId));
    expect(lines[0]!.nutrition).toEqual({ allergens, dietaryDeclarations: [] });
  },
);

it("never substitutes current allergens when a sent row has no captured declaration", async () => {
  const { v, party } = await tableDish("fire");
  const [line] = await inTx(v, (tx) => readTabLines(tx, party.tabId));
  await inTx(v, async (tx) => {
    await tx
      .update(workingLineContexts)
      .set({ sentNutrition: null })
      .where(eq(workingLineContexts.workingOrderLineId, line!.id));
    await updateProduct(tx, v.productId("Burger"), { allergens: { eggs: {} } });
  });
  const lines = await inTx(v, (tx) => readTabLines(tx, party.tabId));
  expect(lines[0]).not.toHaveProperty("nutrition");
  const current = await inTx(v, (tx) => readCurrentOrders(tx, party.partyId));
  for (const row of [...current.ungrouped, ...current.groups.flatMap((group) => group.rows)])
    expect(row).not.toHaveProperty("nutrition");
});

it("records the current counter declaration when placed and leaves a replay unchanged", async () => {
  const v = await setupPartyVenue(suite.db);
  const id = randomUUID();
  await inTx(v, (tx) =>
    createOpenOrder(tx, v.cfg, id, [{ menuItemId: v.counterItem("Burger"), quantity: "1" }], null, {
      zoneId: v.counter.zoneId,
      creditedTo: OPERATOR,
    }),
  );
  await inTx(v, (tx) => updateProduct(tx, v.productId("Burger"), { allergens: { milk: {} } }));
  await placeOrder({ ...v, admission: testTradingAdmission() }, v.cfg, id, OPERATOR);
  await inTx(v, (tx) => updateProduct(tx, v.productId("Burger"), { allergens: { eggs: {} } }));
  await placeOrder({ ...v, admission: testTradingAdmission() }, v.cfg, id, OPERATOR);
  expect((await inTx(v, (tx) => readTabLines(tx, id)))[0]!.nutrition).toEqual({
    allergens: { milk: {} },
    dietaryDeclarations: [],
  });
});

it("captures inherited variant declarations and keeps each extra's own facts, including a later extra", async () => {
  const v = await setupPartyVenue(suite.db);
  const { variant, extra, list } = await inTx(v, async (tx) => {
    await updateProduct(tx, v.productId("Burger"), {
      allergens: { milk: {} },
      dietaryDeclarations: ["vegetarian"],
    });
    const [parent] = await tx
      .select()
      .from(products)
      .where(eq(products.id, v.productId("Burger")));
    const [variant] = await setProductVariants(
      tx,
      parent!.id,
      [
        {
          name: "Large",
          customerName: null,
          kitchenName: null,
          image: null,
          unitPrice: null,
          available: true,
        },
      ],
      v.cfg.locale,
    );
    const extra = await createProduct(tx, {
      catalogueId: parent!.catalogueId,
      categoryId: null,
      name: "Side",
      pricingUnit: "each",
      unitPrice: "1.00",
      vatClass: "reduced",
      allergens: { eggs: {} },
      dietaryDeclarations: ["halal"],
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
    await writeProductModifiers(tx, parent!.id, [{ kind: "extras", id: list.id }]);
    await republishMenus(tx);
    return { variant: variant!, extra, list };
  });
  const party = await seatWithNoAllergies(v, await v.table("Variant with side"));
  const command = {
    submissionId: randomUUID(),
    expectedPartyRevision: await revisionOf(v, party.partyId),
    operatorId: OPERATOR,
    groups: [
      {
        release: "fire" as const,
        lines: [{ menuItemId: v.item("Burger"), variantId: variant.id, quantity: "1" }],
      },
    ],
  };
  await inTx(v, (tx) => submitGroups(tx, v.cfg, party.partyId, command));
  await inTx(v, (tx) =>
    updateProduct(tx, v.productId("Burger"), { allergens: { fish: {} }, dietaryDeclarations: [] }),
  );
  const [dish] = await inTx(v, (tx) => readTabLines(tx, party.tabId));
  await inTx(v, (tx) =>
    updateOrderLine(
      tx,
      v.cfg,
      party.tabId,
      dish!.lineNo,
      { extras: [{ listId: list.id, picks: [{ productId: extra.id, quantity: 1 }] }] },
      1,
      OPERATOR,
    ),
  );
  await inTx(v, (tx) =>
    updateProduct(tx, extra.id, { allergens: { milk: {} }, dietaryDeclarations: [] }),
  );
  const lines = await inTx(v, (tx) => readTabLines(tx, party.tabId));
  expect(lines.map((line) => line.nutrition)).toEqual([
    { allergens: { milk: {} }, dietaryDeclarations: ["vegetarian"] },
    { allergens: { eggs: {} }, dietaryDeclarations: ["halal"] },
  ]);
});

it("keeps captured declarations through quantity splitting and a bill move", async () => {
  const v = await setupPartyVenue(suite.db);
  const id = randomUUID();
  await inTx(v, (tx) => updateProduct(tx, v.productId("Burger"), { allergens: { milk: {} } }));
  const party = await seatWithNoAllergies(v, await v.table("Split declaration"));
  await inTx(v, (tx) =>
    openGroupedCounterOrder(tx, v.cfg, id, [{ menuItemId: v.item("Burger"), quantity: "2" }], {
      zoneId: v.tables.zoneId,
      partyId: party.partyId,
      creditedTo: OPERATOR,
    }),
  );
  await inTx(v, (tx) => fireAll(tx, v.cfg, id));
  expect((await inTx(v, (tx) => readTabLines(tx, id)))[0]!.sentAt).toEqual(expect.any(String));
  await inTx(v, (tx) => splitLinesWithinOrder(tx, v.cfg, id, [{ lineNo: 1, quantity: "1" }]));
  await inTx(v, (tx) => updateProduct(tx, v.productId("Burger"), { allergens: { eggs: {} } }));
  const lines = await inTx(v, (tx) => readTabLines(tx, id));
  expect(lines).toHaveLength(2);
  const other = await split(v, party.partyId, id, [lines[1]!.lineNo]);
  for (const bill of [id, other]) {
    expect((await inTx(v, (tx) => readTabLines(tx, bill))).map((line) => line.nutrition)).toEqual([
      { allergens: { milk: {} }, dietaryDeclarations: [] },
    ]);
  }
});
