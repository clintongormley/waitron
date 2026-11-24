import {
  withTransaction,
  workingOrderLines,
  workingOrders,
  printJobs,
  type Transaction,
  captureError,
  kitchenCourses,
  products,
  nowIso,
} from "@waitron/db";
import * as menu from "@waitron/menu";
import { createCategory, createProduct, createMenu, setProductVariants } from "@waitron/menu";
import { eq, sql, and, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createStation, createCourse, setProductCourse } from "./kitchen.js";
import { priceStoredOrderForIssuance } from "./stored-order-lines.js";
import { cancelLine, cancelItemForTest } from "./testing/cancel-line.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { placeGroupedRound } from "./testing/group-submit-fixture.js";
import { openGroupedCounterOrder } from "./testing/grouped-counter-order.js";
import { updateOrderLine, updateHeldOrder } from "./testing/order-writer-fixture.js";
import { republishMenus } from "./testing/publish-menu.js";
import { openPartyTab } from "./testing/serve-line.js";
import { setStationPrinting } from "./testing/station-printing.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import { parkOrder, createOpenOrder } from "./working-order-open.js";
import { splitLinesWithinOrder } from "./working-order-transfer.js";
import {
  setupVenue,
  db,
  attachedPrinter,
  routeCategory,
  LOCALE,
  attachModifierList,
  makeTable,
  tableOffers,
  OPERATOR,
  addGroupedRound,
  type ProductLine,
  addExtra,
  createOfferedOrder,
  addExtraList,
  makeProduct,
  addRound,
  courseItemsFor,
  parkProducts,
  CONTENT_LANGUAGE,
  seedWine,
  updateProducts,
  revisionOf,
  seedVariantOffer,
} from "./working-order.test-support.js";

describe("a dish's extras children", () => {
  it("rescales a held kitchen ticket by the extra's frozen 50 g portion", async () => {
    const { cfg, coffeeId, kgUnitId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await attachedPrinter(tx, { name: "Kitchen", isDefault: true }, "P-Kitchen");
      const { station: extrasStation } = await attachedPrinter(
        tx,
        { name: "Emplatado" },
        "P-Emplatado",
      );
      const extrasCategory = await createCategory(tx, { name: "Extras" });
      await routeCategory(tx, extrasCategory.id, {
        kind: "station",
        stationId: extrasStation.id,
      });
      const extra = await createProduct(tx, {
        categoryId: extrasCategory.id,
        name: "Ham",
        unitId: kgUnitId,
        unitPrice: "0.27",
        vatClass: "general",
      });
      const list = await menu.createExtraList(
        tx,
        {
          name: "Ham list",
          customerName: null,
          kitchenName: null,
          minPicks: 0,
          maxPicks: 3,
          active: true,
          items: [
            {
              productId: extra.id,
              portion: "0.050",
              maxQuantity: 3,
              preselected: false,
              price: null,
            },
          ],
        },
        LOCALE,
      );
      await attachModifierList(tx, coffeeId, { kind: "extras", id: list.id });
      await setStationPrinting(tx, { printHeldWork: true });
      const tableId = await makeTable(tx);
      const { tabId, partyId } = await openPartyTab(tx, cfg, { tableId });
      const offers = await tableOffers(tx);
      await placeGroupedRound(
        tx,
        cfg,
        { partyId, tabId },
        {
          release: "hold",
          lines: offers.toOfferLines([
            {
              productId: coffeeId,
              quantity: "2",
              extras: [{ listId: list.id, picks: [{ productId: extra.id, quantity: 3 }] }],
            },
          ]),
        },
        OPERATOR,
      );
      const units = await tx
        .select({ soldInEach: workingOrderLines.soldInEach })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo);
      expect(units.map((line) => line.soldInEach)).toEqual([true, false]);
      const [{ revision }] = await tx
        .select({ revision: workingOrders.revision })
        .from(workingOrders)
        .where(eq(workingOrders.id, tabId));
      const beforeJobs = await tx.select({ id: printJobs.id }).from(printJobs);
      await updateOrderLine(tx, cfg, tabId, 1, { portionLineNos: [], quantity: "3" }, revision!);
      const changedJobs = (
        await tx.select({ id: printJobs.id, payload: printJobs.payload }).from(printJobs)
      )
        .filter((job) => !beforeJobs.some((before) => before.id === job.id))
        .map((job) => decodeTicket(job.payload));
      expect(changedJobs.join("\n")).toContain("+0.150 su x Ham");
      const rows = await tx.execute<{
        quantity: number;
        price_quantity: number;
        line_total: number;
        ticket_quantity: number;
      }>(sql`
        select wol.quantity, wol.price_quantity, wol.line_total, ti.quantity as ticket_quantity
        from working_order_lines wol
        join ticket_items ti on ti.working_order_line_id = wol.id
        where wol.working_order_id = ${tabId} and wol.parent_line_id is not null`);
      expect(rows.rows).toEqual([
        { quantity: 450, price_quantity: 50, line_total: 9, ticket_quantity: 450 },
      ]);
      const [{ revision: nextRevision }] = await tx
        .select({ revision: workingOrders.revision })
        .from(workingOrders)
        .where(eq(workingOrders.id, tabId));
      const beforeNoteJobs = await tx.select({ id: printJobs.id }).from(printJobs);
      await updateOrderLine(
        tx,
        cfg,
        tabId,
        1,
        { portionLineNos: [], note: "No salt" },
        nextRevision!,
      );
      const noteJobs = (
        await tx.select({ id: printJobs.id, payload: printJobs.payload }).from(printJobs)
      )
        .filter((job) => !beforeNoteJobs.some((before) => before.id === job.id))
        .map((job) => decodeTicket(job.payload));
      expect(noteJobs.join("\n")).toContain("+0.450 su x Ham");
    });
  });

  it("voids the physical 50 g child amount when a fired dish is cancelled or reduced", async () => {
    const { cfg, coffeeId, kgUnitId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const extrasStation = await createStation(tx, { name: "Emplatado" });
      const extrasCategory = await createCategory(tx, { name: "Extras" });
      await routeCategory(tx, extrasCategory.id, {
        kind: "station",
        stationId: extrasStation.id,
      });
      const extra = await createProduct(tx, {
        categoryId: extrasCategory.id,
        name: "Ham",
        unitId: kgUnitId,
        unitPrice: "0.27",
        vatClass: "general",
      });
      const list = await menu.createExtraList(
        tx,
        {
          name: "Ham list",
          customerName: null,
          kitchenName: null,
          minPicks: 0,
          maxPicks: 3,
          active: true,
          items: [
            {
              productId: extra.id,
              portion: "0.050",
              maxQuantity: 3,
              preselected: false,
              price: null,
            },
          ],
        },
        LOCALE,
      );
      await attachModifierList(tx, coffeeId, { kind: "extras", id: list.id });
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, cfg, { tableId });
      await addGroupedRound(tx, cfg, tabId, [
        {
          productId: coffeeId,
          quantity: "2",
          extras: [{ listId: list.id, picks: [{ productId: extra.id, quantity: 1 }] }],
        },
      ]);
      const fired = await tx.execute<{
        quantity: number;
        made_here: number;
        fired_at: string | null;
      }>(sql`
        select ti.quantity, ti.made_here, ti.fired_at from ticket_items ti
        join working_order_lines wol on wol.id = ti.working_order_line_id
        where wol.working_order_id = ${tabId} and wol.parent_line_id is not null`);
      expect(fired.rows).toHaveLength(1);
      expect(fired.rows[0]).toMatchObject({ quantity: 100, made_here: 0 });
      expect(fired.rows[0]!.fired_at).not.toBeNull();

      await cancelLine(tx, cfg, tabId, 1, "1");

      const notices = await tx.execute<{ quantity: number }>(sql`
        select quantity from kitchen_notices
        where working_order_id = ${tabId} and kind = 'void'
        order by quantity`);
      expect(notices.rows.map((row) => row.quantity)).toEqual([50, 1000]);

      const reducedTableId = await makeTable(tx);
      const { tabId: reducedTabId } = await openPartyTab(tx, cfg, { tableId: reducedTableId });
      await addGroupedRound(tx, cfg, reducedTabId, [
        {
          productId: coffeeId,
          quantity: "2",
          extras: [{ listId: list.id, picks: [{ productId: extra.id, quantity: 1 }] }],
        },
      ]);
      await cancelItemForTest(tx, cfg, reducedTabId, 1, "1");
      const reducedNotices = await tx.execute<{ quantity: number }>(sql`
        select quantity from kitchen_notices
        where working_order_id = ${reducedTabId} and kind = 'void'
        order by quantity`);
      expect(reducedNotices.rows.map((row) => row.quantity)).toEqual([50, 1000]);
    });
  });

  it("retains the set-menu placement metadata when carving a stored dish row", async () => {
    const { cfg, coffeeId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const setMenu = await createMenu(tx, {
        name: "Lunch set menu",
        kind: "set_menu",
        setPrice: "18.00",
        setVatClass: "reduced",
      });
      const tableId = await makeTable(tx);
      const tabId = await openExtrasTab(tx, cfg, tableId, [{ productId: coffeeId, quantity: "2" }]);
      const placement = {
        setMenuRole: "dish",
        setMenuId: setMenu.id,
        setMenuPlace: 2,
        setMenuCountsAsCourseId: randomUUID(),
      } as const;
      await tx
        .update(workingOrderLines)
        .set(placement)
        .where(eq(workingOrderLines.workingOrderId, tabId));

      await splitLinesWithinOrder(tx, cfg, tabId, [{ lineNo: 1, quantity: "1" }]);

      const rows = await tx
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo);
      expect(rows).toMatchObject([
        { ...placement, quantity: 1000 },
        { ...placement, quantity: 1000 },
      ]);
    });
  });

  it("splits a 50 g child with its dish without changing either frozen price", async () => {
    const { cfg, coffeeId, kgUnitId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const extra = await createProduct(tx, {
        categoryId: null,
        name: "Ham",
        unitId: kgUnitId,
        unitPrice: "0.27",
        vatClass: "general",
      });
      const list = await menu.createExtraList(
        tx,
        {
          name: "Ham list",
          customerName: null,
          kitchenName: null,
          minPicks: 0,
          maxPicks: 3,
          active: true,
          items: [
            {
              productId: extra.id,
              portion: "0.050",
              maxQuantity: 3,
              preselected: false,
              price: null,
            },
          ],
        },
        LOCALE,
      );
      await attachModifierList(tx, coffeeId, { kind: "extras", id: list.id });
      const tableId = await makeTable(tx);
      const tabId = await openExtrasTab(tx, cfg, tableId, [
        {
          productId: coffeeId,
          quantity: "2",
          extras: [{ listId: list.id, picks: [{ productId: extra.id, quantity: 3 }] }],
        },
      ]);

      await splitLinesWithinOrder(tx, cfg, tabId, [{ lineNo: 1, quantity: "1" }], {
        splitExtras: true,
      });
      const rows = await tx
        .select({
          parentLineId: workingOrderLines.parentLineId,
          quantity: workingOrderLines.quantity,
          priceQuantity: workingOrderLines.priceQuantity,
          lineTotal: workingOrderLines.lineTotal,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo);
      expect(rows).toHaveLength(4);
      expect(
        rows.map(({ quantity, priceQuantity, lineTotal }) => [quantity, priceQuantity, lineTotal]),
      ).toEqual([
        [1000, 1000, 150],
        [150, 50, 3],
        [1000, 1000, 150],
        [150, 50, 3],
      ]);
    });
  });

  it("keeps one frozen 50 g extra portion when one of two dishes is cancelled", async () => {
    const { cfg, coffeeId, kgUnitId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const extra = await createProduct(tx, {
        categoryId: null,
        name: "Ham",
        unitId: kgUnitId,
        unitPrice: "0.27",
        vatClass: "general",
      });
      const list = await menu.createExtraList(
        tx,
        {
          name: "Ham list",
          customerName: null,
          kitchenName: null,
          minPicks: 0,
          maxPicks: 3,
          active: true,
          items: [
            {
              productId: extra.id,
              portion: "0.050",
              maxQuantity: 3,
              preselected: false,
              price: null,
            },
          ],
        },
        LOCALE,
      );
      await attachModifierList(tx, coffeeId, { kind: "extras", id: list.id });
      const tableId = await makeTable(tx);
      const tabId = await openExtrasTab(tx, cfg, tableId, [
        {
          productId: coffeeId,
          quantity: "2",
          extras: [{ listId: list.id, picks: [{ productId: extra.id, quantity: 1 }] }],
        },
      ]);

      await cancelLine(tx, cfg, tabId, 1, "1");

      const lines = await tx
        .select({
          id: workingOrderLines.id,
          parentLineId: workingOrderLines.parentLineId,
          quantity: workingOrderLines.quantity,
          priceQuantity: workingOrderLines.priceQuantity,
          lineTotal: workingOrderLines.lineTotal,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({
        parentLineId: null,
        quantity: 1000,
        priceQuantity: 1000,
      });
      expect(lines[1]).toMatchObject({
        parentLineId: lines[0]!.id,
        quantity: 50,
        priceQuantity: 50,
        lineTotal: 1,
      });
    });
  });

  /** Attach an extras list whose one product may be picked TWICE, returning the ids the wire needs. A
   *  list that ACCEPTS a tally of two AND an item cap of two, so a doubled pick SUMS to a per-dish
   *  quantity of 2 rather than being dropped, and is valid. */
  async function addMultiExtra(
    tx: Transaction,
    dishId: string,
    name: string,
  ): Promise<{ listId: string; productId: string }> {
    const offered = await createProduct(tx, {
      categoryId: null,
      name,
      pricingUnit: "each",
      unitPrice: "9.99",
      vatClass: "reduced",
    });
    const list = await menu.createExtraList(
      tx,
      {
        name: `${name} list`,
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: 2,
        active: true,
        items: [{ productId: offered.id, maxQuantity: 2, preselected: false, price: "0.50" }],
      },
      LOCALE,
    );
    await attachModifierList(tx, dishId, { kind: "extras", id: list.id });
    return { listId: list.id, productId: offered.id };
  }

  /** An OPEN bill with extras lines for a party seated at a fresh table. Skips firing, so no station
   *  is required. */
  async function openExtrasTab(
    tx: Transaction,
    cfg: DeviceRequestConfig,
    tableId: string,
    lines: ProductLine[],
  ): Promise<string> {
    const id = randomUUID();
    const offers = await tableOffers(tx);
    const { partyId } = await openPartyTab(tx, cfg, { tableId });
    // Grouped, as a counter order written before portions: two cases here split or cancel part of a line.
    await openGroupedCounterOrder(tx, cfg, id, offers.toOfferLines(lines), {
      zoneId: offers.zoneId,
      partyId,
    });
    return id;
  }

  it("voiding a PARENT dish removes its extras children too, leaving only the plain line", async () => {
    const { cfg, coffeeId, waterId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const bacon = await addExtra(tx, coffeeId, "Bacon");
      const tableId = await makeTable(tx);
      // line 1 = coffee (parent), line 2 = bacon (child), line 3 = water (plain).
      const tabId = await openExtrasTab(tx, cfg, tableId, [
        {
          productId: coffeeId,
          quantity: "1",
          extras: [{ listId: bacon.listId, picks: [{ productId: bacon.productId, quantity: 1 }] }],
        },
        { productId: waterId, quantity: "1" },
      ]);
      await cancelLine(tx, cfg, tabId, 1);
      const remaining = await tx
        .select({
          lineNo: workingOrderLines.lineNo,
          productId: workingOrderLines.productId,
          parentLineId: workingOrderLines.parentLineId,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo);
      // Parent (1) AND its child (2) are gone; only the plain water line (3) survives.
      expect(remaining.map((r) => r.lineNo)).toEqual([3]);
      expect(remaining[0]!.productId).toBe(waterId);
    });
  });

  it("cancelling a CHILD extras line removes only that line (its dish stays)", async () => {
    const { cfg, coffeeId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const bacon = await addExtra(tx, coffeeId, "Bacon");
      const tableId = await makeTable(tx);
      // line 1 = espresso (parent), line 2 = bacon (child).
      const tabId = await openExtrasTab(tx, cfg, tableId, [
        {
          productId: coffeeId,
          quantity: "1",
          extras: [{ listId: bacon.listId, picks: [{ productId: bacon.productId, quantity: 1 }] }],
        },
      ]);
      await cancelLine(tx, cfg, tabId, 2);
      const remaining = await tx
        .select({
          lineNo: workingOrderLines.lineNo,
          productId: workingOrderLines.productId,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId))
        .orderBy(workingOrderLines.lineNo);
      // Only the dish left; the child is the one that went.
      expect(remaining.map((r) => r.lineNo)).toEqual([1]);
      expect(remaining[0]!.productId).toBe(coffeeId);
    });
  });

  it("REFUSES a product picked twice in one list rather than dropping or doubling it", async () => {
    const { cfg, coffeeId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const bacon = await addMultiExtra(tx, coffeeId, "Bacon");
      // The same product named twice in one list's picks — reachable via a crafted client. A count
      // belongs in `quantity`, so two entries for one product are a malformed answer and neither
      // entry may be quietly dropped (which would serve and cook an extra unbilled).
      const error = await captureError(() =>
        createOfferedOrder(tx, cfg, randomUUID(), [
          {
            productId: coffeeId,
            quantity: "1",
            extras: [
              {
                listId: bacon.listId,
                picks: [
                  { productId: bacon.productId, quantity: 1 },
                  { productId: bacon.productId, quantity: 1 },
                ],
              },
            ],
          },
        ]),
      );
      expect(error).toMatchObject({ code: "extras.invalid", params: { field: "productId" } });
    });
  });

  it("prices ONE child at the picked per-dish quantity", async () => {
    const { cfg, coffeeId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const bacon = await addMultiExtra(tx, coffeeId, "Bacon"); // maxPicks 2, item cap 2
      const id = randomUUID();
      await createOfferedOrder(tx, cfg, id, [
        {
          productId: coffeeId,
          quantity: "1",
          extras: [{ listId: bacon.listId, picks: [{ productId: bacon.productId, quantity: 2 }] }],
        },
      ]);
      const lines = await tx
        .select({
          lineNo: workingOrderLines.lineNo,
          parentLineId: workingOrderLines.parentLineId,
          productId: workingOrderLines.productId,
          quantity: workingOrderLines.quantity,
          lineTotal: workingOrderLines.lineTotal,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id))
        .orderBy(workingOrderLines.lineNo);
      // ONE parent + ONE child at quantity 2 (dish ×1 × pick ×2), 0.50 × 2 = 1.00 gross. Both
      // columns are read straight off the row, so 100 is that gross in cents and 2000 the two
      // picks in thousandths.
      expect(lines).toHaveLength(2);
      expect(lines[0]!.parentLineId).toBeNull();
      expect(lines.filter((l) => l.parentLineId !== null)).toHaveLength(1);
      expect(lines[1]!.productId).toBe(bacon.productId);
      expect(lines[1]!.quantity).toBe(2000);
      expect(lines[1]!.lineTotal).toBe(100);
    });
  });
});
describe("priceOrderLines extras quantities (resolve loop)", () => {
  /** An extras list offering ONE product at 0.50, with a configurable per-list `maxPicks` and
   *  per-item `maxQuantity`. */
  async function addQtyExtra(
    tx: Transaction,
    dishId: string,
    name: string,
    opts: { maxPicks?: number | null; maxQuantity?: number | null } = {},
  ): Promise<{ listId: string; productId: string }> {
    return addExtraList(tx, dishId, name, {
      price: "0.50",
      vatClass: "reduced",
      maxPicks: opts.maxPicks === undefined ? null : opts.maxPicks,
      maxQuantity: opts.maxQuantity === undefined ? 1 : opts.maxQuantity,
    });
  }

  /** An extras list offering TWO products (each 0.50), for the maxPicks-tally cases with distinct
   *  picks. */
  async function addTwoProductList(
    tx: Transaction,
    dishId: string,
    opts: { maxPicks?: number; maxQuantity?: number } = {},
  ): Promise<{ listId: string; firstProductId: string; secondProductId: string }> {
    const offered = [];
    for (const name of ["Uno", "Dos"]) {
      offered.push(
        await createProduct(tx, {
          categoryId: null,
          name,
          pricingUnit: "each",
          unitPrice: "9.99",
          vatClass: "reduced",
        }),
      );
    }
    const list = await menu.createExtraList(
      tx,
      {
        name: "Extras list",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: opts.maxPicks ?? 2,
        active: true,
        items: offered.map((product) => ({
          productId: product.id,
          maxQuantity: opts.maxQuantity ?? 1,
          preselected: false,
          price: "0.50",
        })),
      },
      LOCALE,
    );
    await attachModifierList(tx, dishId, { kind: "extras", id: list.id });
    return { listId: list.id, firstProductId: offered[0]!.id, secondProductId: offered[1]!.id };
  }

  it("prices & persists a pick ×2 on a dish ×3 as a child of combined quantity 6, dish unchanged", async () => {
    const { cfg, coffeeId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const shot = await addQtyExtra(tx, coffeeId, "Extra shot", {
        maxPicks: 5,
        maxQuantity: 5,
      });
      const request = [
        {
          productId: coffeeId,
          quantity: "3",
          extras: [{ listId: shot.listId, picks: [{ productId: shot.productId, quantity: 2 }] }],
        },
      ];
      const linesOf = (orderId: string) =>
        tx
          .select({
            id: workingOrderLines.id,
            productId: workingOrderLines.productId,
            parentLineId: workingOrderLines.parentLineId,
            quantity: workingOrderLines.quantity,
            unitPriceGross: workingOrderLines.unitPriceGross,
            lineTotal: workingOrderLines.lineTotal,
          })
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, orderId))
          .orderBy(workingOrderLines.lineNo);
      // Grouped, as a counter order written before portions: only a line of several dishes shows
      // the pick multiplied by the dish count.
      const id = randomUUID();
      await createOfferedOrder(tx, cfg, id, request, "grouped");
      const lines = await linesOf(id);
      expect(lines).toHaveLength(2);
      // Parent dish row is UNCHANGED: its own product, no parent link, quantity still 3.
      expect(lines[0]).toMatchObject({
        productId: coffeeId,
        parentLineId: null,
        // Three units, as a count of thousandths off the column.
        quantity: 3000,
      });
      // Child row: combined 3 × 2 = 6, per-unit gross the offer's 0.50, total 0.50 × 6 = 3.00 —
      // read straight off the columns, so 50 and 300 are those amounts as counts of whole cents,
      // and 6000 is the six picks in thousandths.
      expect(lines[1]!.parentLineId).toBe(lines[0]!.id);
      expect(lines[1]!.productId).toBe(shot.productId);
      expect(lines[1]!.quantity).toBe(6000);
      expect(lines[1]!.unitPriceGross).toBe(50);
      expect(lines[1]!.lineTotal).toBe(300);

      // As portions, each of the three dishes carries its own child of 2: 0.50 × 2 = 1.00, and
      // the three together the same 3.00.
      const portionsId = randomUUID();
      await createOfferedOrder(tx, cfg, portionsId, request);
      const portions = await linesOf(portionsId);
      const dishes = portions.filter((line) => line.parentLineId === null);
      expect(dishes.map((dish) => [dish.productId, dish.quantity])).toEqual([
        [coffeeId, 1000],
        [coffeeId, 1000],
        [coffeeId, 1000],
      ]);
      expect(
        portions
          .filter((line) => line.parentLineId !== null)
          .map(({ parentLineId, productId, quantity, unitPriceGross, lineTotal }) => [
            parentLineId,
            productId,
            quantity,
            unitPriceGross,
            lineTotal,
          ]),
      ).toEqual(dishes.map((dish) => [dish.id, shot.productId, 2000, 50, 100]));
    });
  });

  it("rejects a pick quantity above the item's maxQuantity", async () => {
    const { cfg, coffeeId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      // Item cap 2, but list maxPicks 5 so a tally of 3 does NOT trip the list cap first — the
      // per-item cap is what must reject it.
      const shot = await addQtyExtra(tx, coffeeId, "Extra shot", {
        maxPicks: 5,
        maxQuantity: 2,
      });
      await expect(
        createOfferedOrder(tx, cfg, randomUUID(), [
          {
            productId: coffeeId,
            quantity: "1",
            extras: [{ listId: shot.listId, picks: [{ productId: shot.productId, quantity: 3 }] }],
          },
        ]),
      ).rejects.toMatchObject({
        code: "extras.limit_exceeded",
        params: { extraListId: shot.listId },
      });
    });
  });

  it("sells three picks from an item with no quantity limit", async () => {
    const { cfg, coffeeId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const shot = await addQtyExtra(tx, coffeeId, "Extra shot", {
        maxPicks: null,
        maxQuantity: null,
      });
      const id = randomUUID();
      await createOfferedOrder(tx, cfg, id, [
        {
          productId: coffeeId,
          quantity: "1",
          extras: [{ listId: shot.listId, picks: [{ productId: shot.productId, quantity: 3 }] }],
        },
      ]);
      const children = await tx
        .select({ quantity: workingOrderLines.quantity, lineTotal: workingOrderLines.lineTotal })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id));
      expect(children.at(-1)).toEqual({ quantity: 3000, lineTotal: 150 });
    });
  });

  it("rejects a pick quantity of 0, a fraction, or none at all", async () => {
    const { cfg, coffeeId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const shot = await addQtyExtra(tx, coffeeId, "Extra shot", {
        maxPicks: 5,
        maxQuantity: 5,
      });
      // A count is a whole number of at least one, and it is not optional: an absent count is a
      // malformed answer rather than a silent ×1, so a client cannot leave the server to guess how
      // many of something it is serving.
      for (const pick of [
        { productId: shot.productId, quantity: 0 },
        { productId: shot.productId, quantity: 1.5 },
        { productId: shot.productId },
      ] as { productId: string; quantity: number }[]) {
        await expect(
          createOfferedOrder(tx, cfg, randomUUID(), [
            {
              productId: coffeeId,
              quantity: "1",
              extras: [{ listId: shot.listId, picks: [pick] }],
            },
          ]),
        ).rejects.toMatchObject({ code: "extras.invalid", params: { field: "quantity" } });
      }
    });
  });

  it("counts a pick's quantity toward maxPicks: one product ×3 in a maxPicks 2 list is refused", async () => {
    const { cfg, coffeeId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      // Item cap 5 so the ×3 passes the per-item cap; the list's maxPicks 2 is what the summed tally
      // (3) must exceed — proving the tally is the SUM of quantities, not the distinct-product count.
      const shot = await addQtyExtra(tx, coffeeId, "Extra shot", {
        maxPicks: 2,
        maxQuantity: 5,
      });
      await expect(
        createOfferedOrder(tx, cfg, randomUUID(), [
          {
            productId: coffeeId,
            quantity: "1",
            extras: [{ listId: shot.listId, picks: [{ productId: shot.productId, quantity: 3 }] }],
          },
        ]),
      ).rejects.toMatchObject({
        code: "extras.limit_exceeded",
        params: { extraListId: shot.listId },
      });
    });
  });

  it("two distinct products ×1 each fit maxPicks 2, but one taken ×2 tips the summed tally over", async () => {
    const { cfg, coffeeId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const list = await addTwoProductList(tx, coffeeId, {
        maxPicks: 2,
        maxQuantity: 5,
      });
      // one ×1 + one ×1 → tally 2 ≤ maxPicks 2 → OK (two child lines).
      const okId = randomUUID();
      await createOfferedOrder(tx, cfg, okId, [
        {
          productId: coffeeId,
          quantity: "1",
          extras: [
            {
              listId: list.listId,
              picks: [
                { productId: list.firstProductId, quantity: 1 },
                { productId: list.secondProductId, quantity: 1 },
              ],
            },
          ],
        },
      ]);
      const okLines = await tx
        .select({ parentLineId: workingOrderLines.parentLineId })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, okId));
      expect(okLines.filter((l) => l.parentLineId !== null)).toHaveLength(2);

      await expect(
        createOfferedOrder(tx, cfg, randomUUID(), [
          {
            productId: coffeeId,
            quantity: "1",
            extras: [
              {
                listId: list.listId,
                picks: [
                  { productId: list.firstProductId, quantity: 2 },
                  { productId: list.secondProductId, quantity: 1 },
                ],
              },
            ],
          },
        ]),
      ).rejects.toMatchObject({
        code: "extras.limit_exceeded",
        params: { extraListId: list.listId },
      });
    });
  });

  it("a pick of ×1 on a dish ×2 gives a child of 2", async () => {
    const { cfg, coffeeId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      const shot = await addQtyExtra(tx, coffeeId, "Extra shot", {
        maxPicks: 1,
        maxQuantity: 1,
      });
      // Grouped, as a counter order written before portions: only a line of several dishes shows
      // the pick multiplied by the dish count.
      const id = randomUUID();
      await createOfferedOrder(
        tx,
        cfg,
        id,
        [
          {
            productId: coffeeId,
            quantity: "2",
            extras: [{ listId: shot.listId, picks: [{ productId: shot.productId, quantity: 1 }] }],
          },
        ],
        "grouped",
      );
      const lines = await tx
        .select({
          parentLineId: workingOrderLines.parentLineId,
          productId: workingOrderLines.productId,
          quantity: workingOrderLines.quantity,
          lineTotal: workingOrderLines.lineTotal,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id))
        .orderBy(workingOrderLines.lineNo);
      expect(lines).toHaveLength(2);
      // Child combined = dish ×2 × pick ×1 = 2; 0.50 × 2 = 1.00. Off the row: 100 whole cents,
      // and 2000 thousandths for the two.
      expect(lines[1]!.productId).toBe(shot.productId);
      expect(lines[1]!.quantity).toBe(2000);
      expect(lines[1]!.lineTotal).toBe(100);
    });
  });
});
// The product default (`product.course_id`) is not re-screened: that would reject a legitimately
// deactivated default. These cases exercise the shared resolver through `addTabRound`.
describe("priceOrderLines course-override validation", () => {
  /** Open a fresh empty tab in the venue and return its id — the addTabRound host these cases fire on. */
  async function openEmptyTab(tx: Transaction, cfg: DeviceRequestConfig): Promise<string> {
    const tableId = await makeTable(tx);
    const { tabId } = await openPartyTab(tx, cfg, { tableId });
    return tabId;
  }

  it("rejects a malformed (non-uuid) course override with course.not_found", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const coffeeProduct = await makeProduct(tx, {});
      const tabId = await openEmptyTab(tx, cfg);
      await expect(
        addRound(tx, cfg, tabId, [
          { productId: coffeeProduct, quantity: "1", courseId: "not-a-uuid" },
        ]),
      ).rejects.toMatchObject({ code: "course.not_found", params: { courseId: "not-a-uuid" } });
    });
  });

  it("rejects an unknown (well-formed but absent) course override with course.not_found", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const coffeeProduct = await makeProduct(tx, {});
      const tabId = await openEmptyTab(tx, cfg);
      const missing = randomUUID();
      await expect(
        addRound(tx, cfg, tabId, [{ productId: coffeeProduct, quantity: "1", courseId: missing }]),
      ).rejects.toMatchObject({ code: "course.not_found", params: { courseId: missing } });
    });
  });

  it("rejects a DEACTIVATED course override with course.not_found", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const coffeeProduct = await makeProduct(tx, {});
      const tabId = await openEmptyTab(tx, cfg);
      const dead = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      await tx.update(kitchenCourses).set({ active: false }).where(eq(kitchenCourses.id, dead.id));
      await expect(
        addRound(tx, cfg, tabId, [{ productId: coffeeProduct, quantity: "1", courseId: dead.id }]),
      ).rejects.toMatchObject({ code: "course.not_found", params: { courseId: dead.id } });
    });
  });

  it("accepts a valid active course override and resolves it (the override wins over the product default)", async () => {
    const { cfg } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      // The product DEFAULT differs from the override — proving the override WINS and is snapshotted,
      // and that a legitimate active override is not rejected by the screen.
      const def = await createCourse(tx, { name: "Starters", displayOrder: 0 });
      const override = await createCourse(tx, { name: "Mains", displayOrder: 1 });
      const coffeeProduct = await makeProduct(tx, {});
      await setProductCourse(tx, coffeeProduct, def.id);
      const tabId = await openEmptyTab(tx, cfg);
      await addRound(tx, cfg, tabId, [
        { productId: coffeeProduct, quantity: "1", courseId: override.id },
      ]);
      const items = await courseItemsFor(tx, tabId);
      expect(items).toHaveLength(1);
      expect(items[0]!.courseId).toBe(override.id);
    });
  });
});
it("does not let an omitted payload waive a required extras list it cannot satisfy because its only extra product is Unavailable", async () => {
  const { cfg, coffeeId, coffeeOfferId, zoneId } = await setupVenue();
  const bacon = await withTransaction(db, async (tx) => {
    const attached = await addExtraList(tx, coffeeId, "Bacon", { minPicks: 1 });
    await menu.updateProduct(tx, attached.productId, { available: false });
    await republishMenus(tx);
    return attached;
  });
  await expect(
    parkOrder({ db }, cfg, {
      id: randomUUID(),
      zoneId,
      lines: [{ menuItemId: coffeeOfferId, quantity: "1" }],
    }),
  ).rejects.toMatchObject({
    code: "extras.limit_exceeded",
    params: { extraListId: bacon.listId },
  });
});
/**
 * The order path: a dish's OPTIONS answers freeze onto the dish line as
 * `option_snapshots`, and its EXTRAS picks become child lines carrying the picked PRODUCT.
 *
 * Every name in the fixture carries its own text, so a read of the wrong one of the six fails
 * (CLAUDE.md §3).
 */
describe("order path — extras and options", () => {
  interface Seeded {
    cfg: DeviceRequestConfig;
    dishId: string;
    wineId: string;
    extraListId: string;
    optionListId: string;
    labelId: string;
    defaultLanguage: string;
  }

  /** A 10% dish offering a 21% wine as an extra and one options list that must be answered. */
  async function seedDish(maxPicks: number | null = 1): Promise<Seeded> {
    const { cfg } = await setupVenue();
    return withTransaction(db, async (tx) => {
      const { defaultLanguage } = await menu.readContentLanguages(tx, cfg.locale);
      const dish = await createProduct(tx, {
        categoryId: null,
        name: "Pizza",
        pricingUnit: "each",
        unitPrice: "10.00",
        vatClass: "reduced",
      });
      const wine = await createProduct(tx, {
        categoryId: null,
        name: "Wine staff",
        customerName: { [defaultLanguage]: "Wine customer" },
        kitchenName: "Wine kitchen",
        pricingUnit: "each",
        // The list item's own price outranks this, so a child priced at 3.00 would mean the offer
        // was never read.
        unitPrice: "3.00",
        vatClass: "general",
      });
      const extraList = await menu.createExtraList(
        tx,
        {
          name: "Wines staff",
          customerName: { [defaultLanguage]: "Wines customer" },
          kitchenName: "Wines kitchen",
          minPicks: 0,
          maxPicks,
          active: true,
          items: [{ productId: wine.id, maxQuantity: 2, preselected: false, price: "4.50" }],
        },
        cfg.locale,
      );
      const optionList = await menu.createOptionList(
        tx,
        {
          name: "Cooked staff",
          customerName: { [defaultLanguage]: "Cooked customer" },
          kitchenName: "Cooked kitchen",
          defaultLabelId: null,
          active: true,
          labels: [
            {
              name: "Rare staff",
              customerName: { [defaultLanguage]: "Rare customer" },
              kitchenName: "Rare kitchen",
              available: true,
            },
          ],
        },
        cfg.locale,
      );
      await menu.writeProductModifiers(tx, dish.id, [
        { kind: "extras", id: extraList.id },
        { kind: "options", id: optionList.id },
      ]);
      return {
        cfg,
        dishId: dish.id,
        wineId: wine.id,
        extraListId: extraList.id,
        optionListId: optionList.id,
        labelId: optionList.labels[0]!.id,
        defaultLanguage,
      };
    });
  }

  it("freezes the list's and the chosen label's three names onto the dish line", async () => {
    const seeded = await seedDish();
    const id = randomUUID();
    await parkProducts(seeded.cfg, {
      id,
      lines: [
        {
          productId: seeded.dishId,
          quantity: "1",
          options: [{ listId: seeded.optionListId, labelId: seeded.labelId }],
        },
      ],
    });
    const lines = await db
      .select({
        lineNo: workingOrderLines.lineNo,
        optionSnapshots: workingOrderLines.optionSnapshots,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.optionSnapshots).toEqual([
      {
        listId: seeded.optionListId,
        listName: { [seeded.defaultLanguage]: "Cooked staff" },
        listCustomerName: { [seeded.defaultLanguage]: "Cooked customer" },
        listKitchenName: "Cooked kitchen",
        labelName: { [seeded.defaultLanguage]: "Rare staff" },
        labelCustomerName: { [seeded.defaultLanguage]: "Rare customer" },
        labelKitchenName: "Rare kitchen",
      },
    ]);
  });

  it("an extra child line carries product_id and the extra product's OWN VAT class", async () => {
    const seeded = await seedDish();
    const id = randomUUID();
    await parkProducts(seeded.cfg, {
      id,
      lines: [
        {
          productId: seeded.dishId,
          quantity: "2",
          extras: [
            { listId: seeded.extraListId, picks: [{ productId: seeded.wineId, quantity: 1 }] },
          ],
          options: [{ listId: seeded.optionListId, labelId: seeded.labelId }],
        },
      ],
    });
    const lines = await db
      .select({
        lineNo: workingOrderLines.lineNo,
        parentLineId: workingOrderLines.parentLineId,
        productId: workingOrderLines.productId,
        name: workingOrderLines.name,
        descriptions: workingOrderLines.descriptions,
        kitchenName: workingOrderLines.kitchenName,
        quantity: workingOrderLines.quantity,
        unitPriceGross: workingOrderLines.unitPriceGross,
        vatClass: workingOrderLines.vatClass,
        lineTotal: workingOrderLines.lineTotal,
      })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    // Each of the two dishes is its own line, followed by its own wine child.
    expect(lines).toHaveLength(4);
    const ids = await db
      .select({ lineNo: workingOrderLines.lineNo, id: workingOrderLines.id })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    const idOf = (lineNo: number) => ids.find((row) => row.lineNo === lineNo)!.id;
    for (const [dish, child] of [
      [lines[0]!, lines[1]!],
      [lines[2]!, lines[3]!],
    ]) {
      expect(dish.parentLineId).toBeNull();
      expect(dish.productId).toBe(seeded.dishId);
      expect(dish.vatClass).toBe("reduced");
      expect(child.parentLineId).toBe(idOf(dish.lineNo));
      // The child IS the wine, by id.
      expect(child.productId).toBe(seeded.wineId);
      // The wine's three names, frozen: staff on `name`, customer re-keyed onto the venue's
      // invoice locale, kitchen on `kitchen_name`.
      expect(child.name).toBe("Wine staff");
      expect(child.descriptions).toEqual({ [LOCALE]: "Wine customer" });
      expect(child.kitchenName).toBe("Wine kitchen");
      // The extra PRODUCT's own VAT, never the 10% dish's.
      expect(child.vatClass).toBe("general");
      // The list ITEM's price, not the wine's own 3.00; dish ×1 × pick ×1 = 1. All three columns
      // are read straight off the row, each at its own scale: 450 is that 4.50 in whole cents, and
      // 1000 is the one pick in thousandths; the two children together are the 9.00 one wine line of two was.
      expect(child.unitPriceGross).toBe(450);
      expect(child.quantity).toBe(1000);
      expect(child.lineTotal).toBe(450);
    }
  });

  it("keeps an extra child without a make-at station when a chosen dish gains units", async () => {
    const seeded = await seedDish();
    const extras = [
      { listId: seeded.extraListId, picks: [{ productId: seeded.wineId, quantity: 1 }] },
    ];
    await withTransaction(db, async (tx) => {
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const station = await createStation(tx, { name: "Chosen station" });
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, seeded.cfg, { tableId });
      await addRound(tx, seeded.cfg, tabId, [
        {
          productId: seeded.dishId,
          quantity: "1",
          extras,
          options: [{ listId: seeded.optionListId, labelId: seeded.labelId }],
        },
      ]);
      const [parent] = await tx
        .select({ id: workingOrderLines.id })
        .from(workingOrderLines)
        .where(
          and(eq(workingOrderLines.workingOrderId, tabId), isNull(workingOrderLines.parentLineId)),
        );
      await tx
        .update(workingOrderLines)
        .set({ makeAtStationId: station.id })
        .where(eq(workingOrderLines.id, parent!.id));
      const [{ revision }] = await tx
        .select({ revision: workingOrders.revision })
        .from(workingOrders)
        .where(eq(workingOrders.id, tabId));
      await updateOrderLine(
        tx,
        seeded.cfg,
        tabId,
        1,
        { portionLineNos: [], quantity: "2", extras },
        revision!,
        OPERATOR,
      );
      const lines = await tx
        .select({
          parentLineId: workingOrderLines.parentLineId,
          makeAtStationId: workingOrderLines.makeAtStationId,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId));
      expect(lines.filter((line) => line.parentLineId !== null)).toHaveLength(2);
      expect(lines.filter((line) => line.parentLineId === null)).toHaveLength(2);
      expect(
        lines
          .filter((line) => line.parentLineId !== null)
          .every((line) => line.makeAtStationId === null),
      ).toBe(true);
      expect(
        lines
          .filter((line) => line.parentLineId === null)
          .every((line) => line.makeAtStationId === station.id),
      ).toBe(true);
    });
  });

  it("stores a changed answer's customer wording in the default content language alone", async () => {
    const { cfg, coffeeId } = await setupVenue();
    await withTransaction(db, async (tx) => {
      await menu.writeContentLanguages(tx, {
        defaultLanguage: CONTENT_LANGUAGE,
        languages: [CONTENT_LANGUAGE, "ca"],
      });
      await createStation(tx, { name: "Kitchen", isDefault: true });
      const list = await menu.createOptionList(
        tx,
        {
          name: "Milk list staff",
          customerName: { [CONTENT_LANGUAGE]: "Milk customer", ca: "Llet client" },
          kitchenName: "Milk list kitchen",
          defaultLabelId: null,
          active: true,
          labels: [
            {
              name: "Whole staff",
              customerName: { [CONTENT_LANGUAGE]: "Whole customer", ca: "Sencera client" },
              kitchenName: "Whole kitchen",
              available: true,
            },
            {
              name: "Oat staff",
              customerName: { [CONTENT_LANGUAGE]: "Oat customer", ca: "Civada client" },
              kitchenName: "Oat kitchen",
              available: true,
            },
          ],
        },
        LOCALE,
      );
      await attachModifierList(tx, coffeeId, { kind: "options", id: list.id });
      const tableId = await makeTable(tx);
      const { tabId } = await openPartyTab(tx, cfg, { tableId });
      await addRound(tx, cfg, tabId, [
        {
          productId: coffeeId,
          quantity: "1",
          options: [{ listId: list.id, labelId: list.labels[0]!.id }],
        },
      ]);
      const [{ revision }] = await tx
        .select({ revision: workingOrders.revision })
        .from(workingOrders)
        .where(eq(workingOrders.id, tabId));
      await updateOrderLine(
        tx,
        cfg,
        tabId,
        1,
        { portionLineNos: [], options: [{ listId: list.id, labelId: list.labels[1]!.id }] },
        revision!,
        OPERATOR,
      );
      const lines = await tx
        .select({ optionSnapshots: workingOrderLines.optionSnapshots })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, tabId));
      expect(lines.map((line) => line.optionSnapshots)).toEqual([
        [
          {
            listId: list.id,
            listName: { [CONTENT_LANGUAGE]: "Milk list staff" },
            listCustomerName: { [CONTENT_LANGUAGE]: "Milk customer" },
            listKitchenName: "Milk list kitchen",
            labelName: { [CONTENT_LANGUAGE]: "Oat staff" },
            labelCustomerName: { [CONTENT_LANGUAGE]: "Oat customer" },
            labelKitchenName: "Oat kitchen",
          },
        ],
      ]);
    });
  });

  it("refuses a dish whose options list is left unanswered", async () => {
    const seeded = await seedDish();
    await expect(
      parkProducts(seeded.cfg, {
        id: randomUUID(),
        lines: [{ productId: seeded.dishId, quantity: "1" }],
      }),
    ).rejects.toMatchObject({
      code: "options.label_required",
      params: { optionListId: seeded.optionListId },
    });
  });

  it("refuses more picks than the extras list allows", async () => {
    const seeded = await seedDish();
    await expect(
      parkProducts(seeded.cfg, {
        id: randomUUID(),
        lines: [
          {
            productId: seeded.dishId,
            quantity: "1",
            extras: [
              { listId: seeded.extraListId, picks: [{ productId: seeded.wineId, quantity: 2 }] },
            ],
            options: [{ listId: seeded.optionListId, labelId: seeded.labelId }],
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "extras.limit_exceeded",
      params: { extraListId: seeded.extraListId },
    });
  });
});
describe("a parent with Active variants is never sold as itself, as an extra or on a raise", () => {
  afterEach(() => vi.restoreAllMocks());

  /** An extras list on Espresso, published on its offer, offering the wine parent and one of its
   * variants. */
  async function wineExtras(
    tx: Transaction,
    coffeeId: string,
    wine: { parentId: string; wine125: string },
  ) {
    // The fixture needs links the editor refuses: a parent with variants and an archived variant.
    await tx.update(products).set({ active: false }).where(eq(products.parentId, wine.parentId));
    const list = await menu.createExtraList(
      tx,
      {
        name: "Wine list staff",
        customerName: null,
        kitchenName: null,
        minPicks: 0,
        maxPicks: null,
        active: true,
        items: [wine.parentId].map((productId) => ({
          productId,
          maxQuantity: 1,
          preselected: false,
          price: "1.00",
        })),
      },
      LOCALE,
    );
    await tx.execute(sql`insert into extra_list_items (id, list_id, product_id, sort, max_quantity, preselected, price, portion)
      values (${randomUUID()}, ${list.id}, ${wine.wine125}, 1, 1, 0, 100, 1000)`);
    await attachModifierList(tx, coffeeId, { kind: "extras", id: list.id });

    await tx.update(products).set({ active: true }).where(eq(products.parentId, wine.parentId));
    await republishMenus(tx);
    return list.id;
  }

  it("refuses a menu offer's extras pick of a parent with an Active variant, and sells its variant", async () => {
    const { cfg, zoneId, menuId, coffeeId, coffeeOfferId } = await setupVenue();
    const wine = await withTransaction(db, (tx) => seedWine(tx, menuId));
    const listId = await withTransaction(db, (tx) => wineExtras(tx, coffeeId, wine));
    const park = (productId: string, id = randomUUID()) =>
      parkOrder({ db }, cfg, {
        id,
        zoneId,
        lines: [
          {
            menuItemId: coffeeOfferId,
            quantity: "1",
            extras: [{ listId, picks: [{ productId, quantity: 1 }] }],
          },
        ],
      });

    await expect(park(wine.parentId)).rejects.toMatchObject({
      code: "product.variant_required",
      params: { productId: wine.parentId },
    });
    const id = randomUUID();
    await park(wine.wine125, id);
    const rows = await db
      .select({ productId: workingOrderLines.productId })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id))
      .orderBy(workingOrderLines.lineNo);
    expect(rows).toEqual([{ productId: coffeeId }, { productId: wine.wine125 }]);

    // The wine's own offer, with a variant chosen, still sells in a basket whose extras list
    // offers the wine parent.
    const both = randomUUID();
    await parkOrder({ db }, cfg, {
      id: both,
      zoneId,
      lines: [
        { menuItemId: wine.offerId, variantId: wine.wine175, quantity: "1" },
        {
          menuItemId: coffeeOfferId,
          quantity: "1",
          extras: [{ listId, picks: [{ productId: wine.wine125, quantity: 1 }] }],
        },
      ],
    });
    const sold = await db
      .select({ productId: workingOrderLines.productId })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, both))
      .orderBy(workingOrderLines.lineNo);
    expect(sold).toEqual([
      { productId: wine.wine175 },
      { productId: coffeeId },
      { productId: wine.wine125 },
    ]);
  });

  // CLAUDE.md §3: read once for the basket. A three-line basket, one line carrying an extras pick,
  // is what can tell one read from one per line.
  it("asks which products have Active variants once for the whole basket, extras picks included", async () => {
    const { cfg, coffeeId, waterId } = await setupVenue();
    const bacon = await withTransaction(db, (tx) => addExtraList(tx, coffeeId, "Bacon"));
    const spy = vi.spyOn(menu, "parentsWithActiveVariants");

    await parkProducts(cfg, {
      id: randomUUID(),
      lines: [
        {
          productId: coffeeId,
          quantity: "1",
          extras: [{ listId: bacon.listId, picks: [{ productId: bacon.productId, quantity: 1 }] }],
        },
        { productId: coffeeId, quantity: "2" },
        { productId: waterId, quantity: "1" },
      ],
    });

    expect(spy).toHaveBeenCalledTimes(1);
    // An offer line's dish is decided by its variant selection, so only the extras picks are asked.
    expect([...spy.mock.calls[0]![1]]).toEqual([bacon.productId]);
  });

  it("refuses raising a held line whose product has gained an Active variant, and keeps an unchanged one", async () => {
    const { cfg } = await setupVenue();
    const coffee = await withTransaction(db, async (tx) => {
      const product = await createProduct(tx, {
        categoryId: null,
        name: "Coffee",
        pricingUnit: "each",
        unitPrice: "1.20",
        vatClass: "general",
      });
      const [doubleVariant] = await setProductVariants(
        tx,
        product.id,
        [
          {
            name: "Double",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: "1.80",
            available: true,
            active: false,
          },
        ],
        LOCALE,
      );
      return { id: product.id, doubleVariant: doubleVariant! };
    });
    const id = randomUUID();
    await parkProducts(cfg, { id, lines: [{ productId: coffee.id, quantity: "1" }] });
    const [parked] = await db
      .select({ id: workingOrderLines.id, quantity: workingOrderLines.quantity })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    await db.update(products).set({ active: true }).where(eq(products.id, coffee.doubleVariant.id));
    const edit = (quantity: string) =>
      updateProducts(cfg, id, {
        lines: [{ workingOrderLineId: parked!.id, productId: coffee.id, quantity }],
      });
    const stored = () =>
      db
        .select({ id: workingOrderLines.id, quantity: workingOrderLines.quantity })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id));

    await expect(edit("2")).rejects.toMatchObject({
      code: "product.variant_required",
      params: { productId: coffee.id },
    });
    expect(await stored()).toEqual([parked]);
    await edit("1");
    expect(await stored()).toEqual([parked]);
  });
  it("refuses raising a held line whose extra has gained an Active variant, and keeps an unchanged one", async () => {
    const { cfg, coffeeId } = await setupVenue();
    const bacon = await withTransaction(db, (tx) => addExtraList(tx, coffeeId, "Bacon"));
    const extras = [{ listId: bacon.listId, picks: [{ productId: bacon.productId, quantity: 1 }] }];
    const id = randomUUID();
    await parkProducts(cfg, { id, lines: [{ productId: coffeeId, quantity: "1", extras }] });
    const stored = () =>
      db
        .select({
          id: workingOrderLines.id,
          productId: workingOrderLines.productId,
          quantity: workingOrderLines.quantity,
          lineTotal: workingOrderLines.lineTotal,
        })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id))
        .orderBy(workingOrderLines.lineNo);
    const parked = await stored();
    expect(parked.map((row) => row.productId)).toEqual([coffeeId, bacon.productId]);
    // The menu refuses an Active variant on a product an extras list offers
    // (`product.offered_as_extra`), so the variant is saved Inactive and its row made Active directly.
    await withTransaction(db, async (tx) => {
      await setProductVariants(
        tx,
        bacon.productId,
        [
          {
            name: "Bacon ahumado",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: "1.20",
            available: true,
            active: false,
          },
        ],
        LOCALE,
      );
      await tx.update(products).set({ active: true }).where(eq(products.parentId, bacon.productId));
    });
    const edit = (quantity: string) =>
      updateProducts(cfg, id, {
        lines: [{ workingOrderLineId: parked[0]!.id, productId: coffeeId, quantity, extras }],
      });

    await expect(edit("2")).rejects.toMatchObject({
      code: "product.variant_required",
      params: { productId: bacon.productId },
    });
    expect(await stored()).toEqual(parked);
    await edit("1");
    expect(await stored()).toEqual(parked);
  });

  it("refuses raising a menu offer's held line whose product has gained an Active variant", async () => {
    const { cfg, zoneId, coffeeId, coffeeOfferId } = await setupVenue();
    const [doubleVariant] = await withTransaction(db, (tx) =>
      setProductVariants(
        tx,
        coffeeId,
        [
          {
            name: "Double",
            customerName: null,
            kitchenName: null,
            image: null,
            unitPrice: "1.80",
            available: true,
            active: false,
          },
        ],
        LOCALE,
      ),
    );
    const id = randomUUID();
    await parkOrder({ db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: coffeeOfferId, quantity: "1" }],
    });
    const [parked] = await db
      .select({ id: workingOrderLines.id, quantity: workingOrderLines.quantity })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    await withTransaction(db, async (tx) => {
      await tx.update(products).set({ active: true }).where(eq(products.id, doubleVariant!.id));
      await republishMenus(tx);
    });
    const edit = async (quantity: string) =>
      updateHeldOrder({ admission: testTradingAdmission(), db }, cfg, id, {
        revision: await revisionOf(id),
        lines: [{ workingOrderLineId: parked!.id, menuItemId: coffeeOfferId, quantity }],
      });

    await expect(edit("2")).rejects.toMatchObject({
      code: "product.variant_required",
      params: { productId: coffeeId },
    });
    await edit("1");
    expect(
      await db
        .select({ id: workingOrderLines.id, quantity: workingOrderLines.quantity })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id)),
    ).toEqual([parked]);
  });
});
describe("pricing a recorded order distinguishes sold out from archived", () => {
  async function variantOrder(): Promise<{
    orderId: string;
    variantId: string;
    productId: string;
  }> {
    const { cfg, zoneId, menuId } = await setupVenue();
    const orderId = randomUUID();
    const seeded = await withTransaction(db, async (tx) => {
      const offer = await seedVariantOffer(tx, menuId);
      await createOpenOrder(
        tx,
        cfg,
        orderId,
        [{ menuItemId: offer.offerId, variantId: offer.variantId, quantity: "1" }],
        null,
        { zoneId },
      );
      return offer;
    });
    return { orderId, variantId: seeded.variantId, productId: seeded.productId };
  }

  it.each(["productId", "variantId"] as const)(
    "prices a recorded variant when its %s sells out",
    async (target) => {
      const order = await variantOrder();
      await db.execute(sql`update products set available = 0 where id = ${order[target]}`);
      await expect(
        withTransaction(db, (tx) => priceStoredOrderForIssuance(tx, order.orderId)),
      ).resolves.toMatchObject({ gross: { total: "3.20" } });
    },
  );

  it.each(["productId", "variantId"] as const)(
    "refuses a recorded variant when its %s is archived",
    async (target) => {
      const order = await variantOrder();
      await db.execute(sql`update products set active = 0 where id = ${order[target]}`);
      await expect(
        withTransaction(db, (tx) => priceStoredOrderForIssuance(tx, order.orderId)),
      ).rejects.toMatchObject({
        code: "product.unavailable",
        params: { productId: order.variantId },
      });
    },
  );

  it("prices an active recorded variant and keeps it payable after its parent is archived once sent", async () => {
    const { orderId, productId } = await variantOrder();
    await expect(
      withTransaction(db, (tx) => priceStoredOrderForIssuance(tx, orderId)),
    ).resolves.toMatchObject({ gross: { total: "3.20" } });

    await db.execute(sql`update working_order_lines set sent_at = ${nowIso()}
      where working_order_id = ${orderId}`);
    await db.execute(sql`update products set active = 0 where id = ${productId}`);
    await expect(
      withTransaction(db, (tx) => priceStoredOrderForIssuance(tx, orderId)),
    ).resolves.toMatchObject({ gross: { total: "3.20" } });
  });
});
