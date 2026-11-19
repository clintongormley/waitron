import { eq, sql, type SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { checkFailed, refusalOn, triggerRaised } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { UNIQUE_VIOLATION } from "../sql-state.js";
import { captureError } from "../testing/errors.js";
import { seedMenuItem, seedPerson, seedVenue, seedWorkingOrder } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { menus } from "./menus.js";
import { menuItems } from "./menu/menu.js";
import { orderDraftLines, orderDrafts } from "./order-drafts.js";
import { workingOrderLines, workingOrders } from "./orders.js";
import { parties } from "./parties.js";

const MENU = "set-menu";
const VERSION = "full-menu-copy";
const SET_LINE = "bill-set-menu";
const DISH = "placed-dish";
const COURSE = "starter";
const ROLE_CHECK = "working_order_lines_set_menu_ck";

describe("set menu storage on a bill", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let billId: string;
  let personId: string;
  let menuItemId: string;
  let productId: string;
  let fullMenuId: string;

  beforeEach(async () => {
    const db = suite.db;
    await seedVenue(db, { invoiceLocales: ["en"] });
    personId = await seedPerson(db);
    billId = (await seedWorkingOrder(db)).id;
    menuItemId = await seedMenuItem(db);
    const [item] = await db.select().from(menuItems).where(eq(menuItems.id, menuItemId));
    productId = item.productId;
    fullMenuId = item.menuId;
    await db.insert(menus).values({
      id: MENU,
      name: "Lunch set menu",
      kind: "set_menu",
      setPrice: 1800,
      setVatClass: "reduced",
    });
    await db.execute(sql`insert into menu_versions
      (id, menu_id, number, document, content_hash, created_at, created_by)
      values (${VERSION}, ${fullMenuId}, 1, '{}', 'copy', 0, ${personId})`);
  });

  function addSetMenu(versionId: string | null = VERSION, product: string | null = null) {
    return suite.db.execute(sql`insert into working_order_lines
      (id, working_order_id, line_no, name, descriptions, product_id, quantity,
       unit_price_gross, line_total, vat_class, takeaway_vat_class,
       set_menu_role, set_menu_id, set_menu_version_id)
      values (${SET_LINE}, ${billId}, 1, 'Lunch set menu', '{"en":"Lunch set menu"}',
       ${product}, 1000, 1800, 1800, 'reduced', 'reduced', 'set_menu', ${MENU}, ${versionId})`);
  }

  function addDish() {
    return suite.db.execute(sql`insert into working_order_lines
      (id, working_order_id, line_no, name, descriptions, product_id, quantity,
       unit_price_gross, line_total, vat_class, takeaway_vat_class,
       menu_item_id, menu_id, menu_name, offer_department_id, department_name, unit_id,
       sold_in_each, offer_unit_name, offer_unit_precision, offer_vat_class, offer_category_name,
       set_menu_role, set_menu_id, set_menu_line_id, set_menu_place, set_menu_counts_as_course_id)
      values (${DISH}, ${billId}, 2, 'Soup', '{"en":"Soup"}', ${productId}, 1000,
       250, 250, 'reduced', 'reduced',
       ${menuItemId}, ${fullMenuId}, 'Lunch', 'dining-room', 'Dining room', 'each',
       1, '{"en":"portion"}', 0, 'reduced', 'Starters',
       'dish', ${MENU}, ${SET_LINE}, 1, ${COURSE})`);
  }

  function updateLine(lineId: string, column: string, value: string | number | null) {
    return suite.db.execute(sql`update working_order_lines
      set ${sql.identifier(column)} = ${value} where id = ${lineId}`);
  }

  async function expectCheck(write: () => unknown, check = ROLE_CHECK) {
    const error = await captureError(write);
    expect(error).toHaveProperty("message", expect.stringContaining(check));
    expect(checkFailed(error, check)).toBe(true);
  }

  it("requires a set menu and its copy on a set-menu line and refuses a product", async () => {
    await expectCheck(() => addSetMenu(VERSION, productId));
    await expectCheck(() => addSetMenu(null));
    await addSetMenu();
    await expectCheck(() => updateLine(SET_LINE, "set_menu_id", null));
    expect(
      await suite.db.all(sql`select product_id, set_menu_id, set_menu_version_id
      from working_order_lines where id = ${SET_LINE}`),
    ).toEqual([{ product_id: null, set_menu_id: MENU, set_menu_version_id: VERSION }]);
  });

  it("requires the set menu, place and counts-as course on a placed dish", async () => {
    await addSetMenu();
    await addDish();
    for (const column of ["set_menu_id", "set_menu_place", "set_menu_counts_as_course_id"]) {
      await expectCheck(() => updateLine(DISH, column, null));
    }
    await expectCheck(() => updateLine(DISH, "set_menu_version_id", VERSION));
    await expectCheck(() => updateLine(DISH, "parent_line_id", SET_LINE));
  });

  it("lets an ordinary extra belong to a set-menu dish without carrying its own set-menu values", async () => {
    await addSetMenu();
    await addDish();
    const db = suite.db;
    await db.insert(workingOrderLines).values({
      id: "extra",
      workingOrderId: billId,
      lineNo: 3,
      name: "Bread",
      descriptions: { en: "Bread" },
      parentLineId: DISH,
      quantity: 1000,
      unitPriceGross: 100,
      lineTotal: 100,
      vatClass: "reduced",
      takeawayVatClass: "reduced",
    });
    for (const [column, value] of [
      ["set_menu_id", MENU],
      ["set_menu_version_id", VERSION],
      ["set_menu_line_id", SET_LINE],
      ["set_menu_place", 1],
      ["set_menu_counts_as_course_id", COURSE],
    ] as const) {
      await expectCheck(() => updateLine("extra", column, value));
    }
  });

  it("clears the dish's link when the set-menu line is deleted, retaining its place and price", async () => {
    await addSetMenu();
    await addDish();
    await suite.db.delete(workingOrderLines).where(eq(workingOrderLines.id, SET_LINE));
    expect(
      await suite.db.all(sql`select set_menu_line_id, set_menu_place, line_total
      from working_order_lines where id = ${DISH}`),
    ).toEqual([{ set_menu_line_id: null, set_menu_place: 1, line_total: 250 }]);
  });

  it("stores one copy per bill and set menu and deletes it with the bill", async () => {
    const db = suite.db;
    const addCopy = () =>
      db.execute(sql`insert into bill_set_menu_copies
        (working_order_id, set_menu_id, menu_version_id) values (${billId}, ${MENU}, ${VERSION})`);
    await addCopy();
    const error = await captureError(addCopy);
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "bill_set_menu_copies",
        columns: ["working_order_id", "set_menu_id"],
      }),
    ).toBe(true);
    await db.delete(workingOrders).where(eq(workingOrders.id, billId));
    expect(await db.all(sql`select * from bill_set_menu_copies`)).toEqual([]);
  });

  it("keeps a moved menu's copy and price alongside the receiving bill's copy", async () => {
    const db = suite.db;
    const receiver = (await seedWorkingOrder(db)).id;
    const newerCopy = "newer-full-menu-copy";
    await db.execute(sql`insert into menu_versions
      (id, menu_id, number, document, content_hash, created_at, created_by)
      values (${newerCopy}, ${fullMenuId}, 2, '{}', 'newer copy', 1, ${personId})`);
    await db.execute(sql`insert into bill_set_menu_copies
      (working_order_id, set_menu_id, menu_version_id)
      values (${billId}, ${MENU}, ${VERSION}), (${receiver}, ${MENU}, ${newerCopy})`);
    await addSetMenu();

    await db
      .update(workingOrderLines)
      .set({ workingOrderId: receiver })
      .where(eq(workingOrderLines.id, SET_LINE));

    expect(
      await db.all(sql`
      select line.set_menu_version_id as line_version, line.line_total,
             copies.menu_version_id as bill_version
      from working_order_lines line inner join bill_set_menu_copies copies
        on copies.working_order_id = line.working_order_id and copies.set_menu_id = line.set_menu_id
      where line.id = ${SET_LINE} and line.working_order_id = ${receiver}
    `),
    ).toEqual([{ line_version: VERSION, line_total: 1800, bill_version: newerCopy }]);
  });

  it("requires both parts of a draft reservation, and only with its set menu", async () => {
    const db = suite.db;
    const [party] = await db.insert(parties).values({ openedBy: personId }).returning();
    const [draft] = await db
      .insert(orderDrafts)
      .values({ partyId: party.id, ownerId: personId })
      .returning();
    const [line] = await db
      .insert(orderDraftLines)
      .values({
        draftId: draft.id,
        position: 1,
        menuItemId,
        options: [],
        extras: [],
        quantity: 1000,
      })
      .returning({ id: orderDraftLines.id });
    const reserve = (menuId: string | null, setLine: string | null, place: number | null) =>
      db.execute(sql`update order_draft_lines set set_menu_id = ${menuId},
        set_menu_reserved_line_id = ${setLine}, set_menu_reserved_place = ${place}
        where id = ${line.id}`);
    for (const [menuId, setLine, place] of [
      [null, SET_LINE, 1],
      [MENU, SET_LINE, null],
      [MENU, null, 1],
    ] as const) {
      await expectCheck(() => reserve(menuId, setLine, place), "order_draft_lines_set_menu_ck");
    }
    await reserve(MENU, null, null);
    await reserve(MENU, SET_LINE, 1);
    expect(
      await db.all(sql`select set_menu_id, set_menu_reserved_line_id, set_menu_reserved_place
      from order_draft_lines where id = ${line.id}`),
    ).toEqual([
      { set_menu_id: MENU, set_menu_reserved_line_id: SET_LINE, set_menu_reserved_place: 1 },
    ]);
  });

  it("keeps each set-menu column fixed when recording service on a placed bill", async () => {
    await addSetMenu();
    await addDish();
    const db = suite.db;
    await db.update(workingOrders).set({ status: "placed" }).where(eq(workingOrders.id, billId));
    const serveDish = (change: SQL) =>
      db.execute(
        sql`update working_order_lines set served_quantity = 1000${change} where id = ${DISH}`,
      );
    for (const [column, value] of [
      ["set_menu_role", "set_menu"],
      ["set_menu_id", "another-menu"],
      ["set_menu_version_id", VERSION],
      ["set_menu_line_id", null],
      ["set_menu_place", 2],
      ["set_menu_counts_as_course_id", "main"],
    ] as const) {
      const error = await captureError(() =>
        serveDish(sql`, ${sql.identifier(column)} = ${value}`),
      );
      expect(triggerRaised(error, "lines may only be written while the order is open")).toBe(true);
    }
    await serveDish(sql``);
  });
});
