import { randomUUID } from "node:crypto";
import { locationId as brandLocationId } from "@waitron/shared";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { refusalOn, triggerRaised } from "../constraint-target.js";
import {
  CHECK_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  RESTRICT_VIOLATION,
  UNIQUE_VIOLATION,
} from "../sql-state.js";
import { TRANSITION_REFUSAL } from "../trigger-refusals.js";
import { isRefusal } from "../unique-violation.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { useVenueDb } from "../testing/venue-db.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { seedNode } from "../testing/seed.js";
import { catalogues, products } from "./catalogue.js";
import { workingOrderLines, workingOrders } from "./orders.js";
import { locations, tenants, tills } from "./tenants.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

afterEach(async () => {
  await suite.db.transaction(async (tx) => {
    // Cleanup must remove lines whose parent is already terminal, which
    // `working_order_lines_require_open_parent_delete` refuses, so the trigger is dropped and put
    // back. Its own statement is replayed from `sqlite_master` so a later edit to the migration
    // cannot leave this fixture restoring a stale definition, and it is inside the transaction so
    // a cleanup that throws rolls the drop back too.
    const [guard] = (
      await tx.execute<{ sql: string }>(
        sql`select sql from sqlite_master
             where type = 'trigger' and name = 'working_order_lines_require_open_parent_delete'`,
      )
    ).rows;
    if (guard === undefined) {
      throw new Error(
        "working_order_lines_require_open_parent_delete is missing — this cleanup drops and " +
          "restores it, and restoring nothing would silently leave the guard off for every " +
          "later case in this file",
      );
    }
    await tx.execute(sql`drop trigger working_order_lines_require_open_parent_delete`);
    await tx.execute(sql`delete from working_order_lines`);
    await tx.execute(sql`delete from working_orders`);
    await tx.execute(sql`delete from products`);
    await tx.execute(sql`delete from catalogues`);
    await tx.execute(sql`delete from nodes`);
    await tx.execute(sql`delete from tills`);
    await tx.execute(sql`delete from locations`);
    await tx.execute(sql`delete from tenants`);
    await tx.execute(sql.raw(guard.sql));
  });
});

const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const AT = "2026-07-20T19:20:30+00:00";

let productA = "";
let orderNumberSeq = 0;

async function rows<T>(db: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] } | T[];
  return Array.isArray(result) ? result : result.rows;
}

async function seed(db: Database): Promise<void> {
  await db
    .insert(tenants)
    .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
  await db.insert(locations).values([
    {
      id: LOCATION_A,
      // Bilingual on purpose: a single-locale venue cannot detect a trigger
      // that checks "at least one locale" instead of "exactly these".
      name: "Fixture Location A",
      invoiceLocales: ["es", "ca"],
      operationDescription: "Hostelería",
    },
  ]);
  await db.insert(tills).values([{ id: TILL_A1, locationId: LOCATION_A, name: "A1" }]);
  const [catA] = await db
    .insert(catalogues)
    .values({ name: "Deli A" })
    .returning({ id: catalogues.id });
  const [prodA] = await db
    .insert(products)
    .values({
      catalogueId: catA.id,
      name: "Café solo",
      pricingUnit: "each",
      unitPrice: 130,
      vatClass: "general",
    })
    .returning({ id: products.id });
  productA = prodA.id;
}

async function openOrder(db: Database, tillId = TILL_A1): Promise<string> {
  const [row] = await db
    .insert(workingOrders)
    .values({ tillId, orderNumber: ++orderNumberSeq, status: "open", openedAt: AT })
    .returning({ id: workingOrders.id });
  return row.id;
}

const LINE = {
  lineNo: 1,
  name: "Café solo",
  descriptions: { es: "Café solo", ca: "Cafè sol" },
  // One unit, in whole thousandths.
  quantity: 1000,
  unitPrice: 130,
  // 1.30 net at 10% VAT, gross, in whole cents.
  unitPriceGross: 143,
  // 10.00%, in whole basis points — the same number as the quantity above meaning something else.
  vatRate: 1000,
  lineTotal: 130,
};

describe("working_orders", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
    await seed(db);
  });

  it("opens an order in the open state with no settled_at", async () => {
    const id = await openOrder(db);
    const [row] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(row.status).toBe("open");
    expect(row.settledAt).toBeNull();
  });

  it("rejects a status outside the allowed set", async () => {
    const error = await captureError(() =>
      db.execute(
        // `id` and `order_number` are named so the statement reaches the status CHECK rather than
        // a NOT NULL refusal: `id` is a `$defaultFn` generator a raw insert never runs.
        sql`insert into working_orders (id, till_id, order_number, status, opened_at)
             values (${randomUUID()}, ${TILL_A1}, ${++orderNumberSeq}, 'paid', ${AT})`,
      ),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/working_orders_status_ck/);

    // The control in the other direction. A CHECK that refused everything would satisfy the
    // assertion above just as well; `placed` is a listed status and no other case in this file
    // writes one, so it is the value that separates "this list is enforced" from "nothing gets in".
    await db.execute(
      sql`insert into working_orders (id, till_id, order_number, status, opened_at)
           values (${randomUUID()}, ${TILL_A1}, ${++orderNumberSeq}, 'placed', ${AT})`,
    );
    const placed = await rows<{ status: string }>(
      db,
      sql`select status from working_orders where status = 'placed'`,
    );
    expect(placed).toEqual([{ status: "placed" }]);
  });

  it("amends an open order", async () => {
    const id = await openOrder(db);
    await db.insert(workingOrderLines).values({ ...LINE, productId: productA, workingOrderId: id });
    await db
      .insert(workingOrderLines)
      .values({ ...LINE, productId: productA, lineNo: 2, workingOrderId: id });
    await db
      .update(workingOrderLines)
      .set({ quantity: 2000, lineTotal: 260 })
      .where(eq(workingOrderLines.workingOrderId, id));
    const found = await db
      .select({ total: workingOrderLines.lineTotal })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.workingOrderId, id));
    expect(found.map((r) => r.total)).toEqual([260, 260]);
  });

  it("settles an open order and stamps settled_at", async () => {
    const id = await openOrder(db);
    await db
      .update(workingOrders)
      .set({ status: "settled", settledAt: AT })
      .where(eq(workingOrders.id, id));
    const [row] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(row.status).toBe("settled");
    expect(row.settledAt).not.toBeNull();
  });

  it("abandons an open order", async () => {
    const id = await openOrder(db);
    await db.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id));
    const [row] = await db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(row.status).toBe("abandoned");
    expect(row.settledAt).toBeNull();
  });

  it("rejects settling without a settled_at", async () => {
    const id = await openOrder(db);
    const error = await captureError(() =>
      db.update(workingOrders).set({ status: "settled" }).where(eq(workingOrders.id, id)),
    );
    expect(engineErrorMessage(error)).toMatch(/working_orders_settled_at_ck/);
  });

  it("rejects a settled_at on an order that is not settled", async () => {
    const id = await openOrder(db);
    const error = await captureError(() =>
      db.update(workingOrders).set({ settledAt: AT }).where(eq(workingOrders.id, id)),
    );
    expect(engineErrorMessage(error)).toMatch(/working_orders_settled_at_ck/);
  });

  // The transition trigger raises ONE fixed sentence for every refused transition, so the cases
  // below cannot check WHICH states it read — only that this trigger refused.
  it("rejects settled → open", async () => {
    const id = await openOrder(db);
    await db
      .update(workingOrders)
      .set({ status: "settled", settledAt: AT })
      .where(eq(workingOrders.id, id));
    const error = await captureError(() =>
      db
        .update(workingOrders)
        .set({ status: "open", settledAt: null })
        .where(eq(workingOrders.id, id)),
    );
    expect(triggerRaised(error, TRANSITION_REFUSAL)).toBe(true);
  });

  it("rejects settled → abandoned", async () => {
    const id = await openOrder(db);
    await db
      .update(workingOrders)
      .set({ status: "settled", settledAt: AT })
      .where(eq(workingOrders.id, id));
    const error = await captureError(() =>
      db
        .update(workingOrders)
        .set({ status: "abandoned", settledAt: null })
        .where(eq(workingOrders.id, id)),
    );
    expect(triggerRaised(error, TRANSITION_REFUSAL)).toBe(true);
  });

  it("rejects abandoned → open", async () => {
    const id = await openOrder(db);
    await db.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id));
    const error = await captureError(() =>
      db.update(workingOrders).set({ status: "open" }).where(eq(workingOrders.id, id)),
    );
    expect(triggerRaised(error, TRANSITION_REFUSAL)).toBe(true);
  });

  it("rejects abandoned → settled", async () => {
    const id = await openOrder(db);
    await db.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id));
    const error = await captureError(() =>
      db
        .update(workingOrders)
        .set({ status: "settled", settledAt: AT })
        .where(eq(workingOrders.id, id)),
    );
    expect(triggerRaised(error, TRANSITION_REFUSAL)).toBe(true);
  });

  it("rejects a no-op update of a settled order", async () => {
    // Terminal means terminal, not "terminal for the columns we thought of".
    const id = await openOrder(db);
    await db
      .update(workingOrders)
      .set({ status: "settled", settledAt: AT })
      .where(eq(workingOrders.id, id));
    const error = await captureError(() =>
      db.update(workingOrders).set({ tillId: TILL_A1 }).where(eq(workingOrders.id, id)),
    );
    expect(triggerRaised(error, TRANSITION_REFUSAL)).toBe(true);
  });

  it("rejects a no-op update of an abandoned order", async () => {
    const id = await openOrder(db);
    await db.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id));
    const error = await captureError(() =>
      db.update(workingOrders).set({ tillId: TILL_A1 }).where(eq(workingOrders.id, id)),
    );
    expect(triggerRaised(error, TRANSITION_REFUSAL)).toBe(true);
  });

  it("carries a nullable node_id column referencing nodes", async () => {
    const node = await seedNode(db, brandLocationId(LOCATION_A));
    const meta = await rows<{ notnull: number }>(
      db,
      sql`select "notnull" from pragma_table_info('working_orders') where name = 'node_id'`,
    );
    expect(meta).toEqual([{ notnull: 0 }]);
    const plainId = await openOrder(db);
    const [plain] = await db.select().from(workingOrders).where(eq(workingOrders.id, plainId));
    expect(plain.nodeId).toBeNull();
    const [withNode] = await db
      .insert(workingOrders)
      .values({
        tillId: TILL_A1,
        orderNumber: ++orderNumberSeq,
        status: "open",
        openedAt: AT,
        nodeId: node,
      })
      .returning({ nodeId: workingOrders.nodeId });
    expect(withNode.nodeId).toBe(node);
  });

  it("rejects a node_id that does not exist with a foreign-key violation", async () => {
    const error = await captureError(() =>
      db.insert(workingOrders).values({
        tillId: TILL_A1,
        orderNumber: ++orderNumberSeq,
        status: "open",
        openedAt: AT,
        nodeId: "99999999-9999-4999-8999-999999999999",
      }),
    );
    // SQLite names neither the constraint nor the column, so the CLASS is all there is to assert.
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });
});

describe("working_order_lines", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
    await seed(db);
  });

  it("adds a line to an open order", async () => {
    const id = await openOrder(db);
    await db.insert(workingOrderLines).values({ ...LINE, productId: productA, workingOrderId: id });
    const found = await db.select().from(workingOrderLines);
    expect(found).toHaveLength(1);
    expect(found[0].descriptions).toEqual({ es: "Café solo", ca: "Cafè sol" });
  });

  it("rejects a duplicate line_no within an order", async () => {
    const id = await openOrder(db);
    await db.insert(workingOrderLines).values({ ...LINE, productId: productA, workingOrderId: id });
    const error = await captureError(() =>
      db.insert(workingOrderLines).values({ ...LINE, productId: productA, workingOrderId: id }),
    );
    // The colliding columns, not just the class: `id`'s primary key would satisfy the class alone.
    expect(
      refusalOn(error, UNIQUE_VIOLATION, {
        table: "working_order_lines",
        columns: ["working_order_id", "line_no"],
      }),
    ).toBe(true);
  });

  it("rejects a line added to a settled order", async () => {
    const id = await openOrder(db);
    await db
      .update(workingOrders)
      .set({ status: "settled", settledAt: AT })
      .where(eq(workingOrders.id, id));
    const error = await captureError(() =>
      db.insert(workingOrderLines).values({ ...LINE, productId: productA, workingOrderId: id }),
    );
    expect(engineErrorMessage(error)).toMatch(/lines may only be written while the order is open/);
  });

  it("rejects a line added to an abandoned order", async () => {
    const id = await openOrder(db);
    await db.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id));
    const error = await captureError(() =>
      db.insert(workingOrderLines).values({ ...LINE, productId: productA, workingOrderId: id }),
    );
    expect(engineErrorMessage(error)).toMatch(/lines may only be written while the order is open/);
  });

  it("rejects deleting a line from a settled order", async () => {
    // Deletion is the transition that would otherwise slip through: the
    // trigger has to cover DELETE, and OLD rather than NEW carries the id.
    const id = await openOrder(db);
    await db.insert(workingOrderLines).values({ ...LINE, productId: productA, workingOrderId: id });
    await db
      .update(workingOrders)
      .set({ status: "settled", settledAt: AT })
      .where(eq(workingOrders.id, id));
    const error = await captureError(() =>
      db.delete(workingOrderLines).where(eq(workingOrderLines.workingOrderId, id)),
    );
    expect(engineErrorMessage(error)).toMatch(/lines may only be written while the order is open/);
  });

  it("rejects descriptions missing a configured locale", async () => {
    const id = await openOrder(db);
    const error = await captureError(() =>
      db.insert(workingOrderLines).values({
        ...LINE,
        productId: productA,
        workingOrderId: id,
        descriptions: { es: "Café solo" },
      }),
    );
    expect(engineErrorMessage(error)).toMatch(/descriptions must carry exactly the venue locales/);
  });

  it("rejects descriptions carrying an unconfigured locale", async () => {
    const id = await openOrder(db);
    const error = await captureError(() =>
      db.insert(workingOrderLines).values({
        ...LINE,
        productId: productA,
        workingOrderId: id,
        descriptions: { es: "Café solo", ca: "Cafè sol", en: "Black coffee" },
      }),
    );
    expect(engineErrorMessage(error)).toMatch(/descriptions must carry exactly the venue locales/);
  });

  it("keeps a line's descriptions when the venue's locales change afterwards", async () => {
    // The snapshot is the whole point. Re-rendering a line through a later
    // configuration would mean a receipt reprinted next year reads differently
    // from the one the customer took.
    const id = await openOrder(db);
    await db.insert(workingOrderLines).values({ ...LINE, productId: productA, workingOrderId: id });
    await db
      .update(locations)
      .set({ invoiceLocales: ["es", "en"] })
      .where(eq(locations.id, LOCATION_A));
    const [line] = await db.select().from(workingOrderLines);
    expect(line.descriptions).toEqual({ es: "Café solo", ca: "Cafè sol" });
  });

  it("carries only product_id as a catalogue-shaped identifier", async () => {
    // Reads column NAMES only, so a catalogue reference under an unrelated name passes.
    const cols = await rows<{ name: string }>(
      db,
      sql`select name from pragma_table_info('working_order_lines')`,
    );
    const references = cols
      .map((c) => c.name)
      .filter((n) => /(product|item|catalogue|catalog|menu|sku|variant|category)_id$/i.test(n))
      .sort();
    expect(references).toEqual(["product_id"]);
  });

  it("carries a nullable note column (KDS-only, NON-FISCAL — spec §2/§3)", async () => {
    // `lower(type)`: the pragma reports the type in the case the DDL declared it.
    const meta = await rows<{ name: string; type: string; notnull: number }>(
      db,
      sql`select name, lower(type) as type, "notnull" from pragma_table_info('working_order_lines')
           where name = 'note'`,
    );
    expect(meta).toEqual([{ name: "note", type: "text", notnull: 0 }]);
  });

  it("stores every monetary column as integer, a whole count of cents", async () => {
    // Pins the storage class and NOT the unit: `money`, `quantity` and `bigCount` all emit the
    // same SQL type.
    const cols = await rows<{ name: string; type: string }>(
      db,
      sql`select name, lower(type) as type from pragma_table_info('working_order_lines')
           where name in ('unit_price', 'unit_price_gross', 'line_total')`,
    );
    expect(cols).toHaveLength(3);
    for (const col of cols) {
      expect(col.type).toBe("integer");
    }
  });
});

/** `product_id` is NULLABLE, and no case here exercises a line naming no product. */
describe("working_order_lines — the draft line's links", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
    await seed(db);
  });

  // `id` is passed explicitly because it is a `$defaultFn` generator a raw insert never runs.
  async function insertLine(opts: {
    workingOrderId: string;
    lineNo: number;
    productId: string | null;
    parentLineId?: string | null;
    descriptions?: string;
  }): Promise<{ id: string }[]> {
    const descriptions = opts.descriptions ?? '{"es":"Café solo","ca":"Cafè sol"}';
    return rows<{ id: string }>(
      db,
      sql`insert into working_order_lines (id, working_order_id, line_no, product_id, name, descriptions, quantity, unit_price, unit_price_gross, vat_rate, line_total, parent_line_id) values (${randomUUID()}, ${opts.workingOrderId}, ${opts.lineNo}, ${opts.productId}, 'Café solo',
             ${descriptions}, 1000, 130, 143, 1000, 130,
             ${opts.parentLineId ?? null}
           ) returning id`,
    );
  }

  it("links a child extra line to its parent dish line, and the child names its own product", async () => {
    const orderId = await openOrder(db);
    const [parent] = await insertLine({ workingOrderId: orderId, lineNo: 1, productId: productA });
    const [child] = await insertLine({
      workingOrderId: orderId,
      lineNo: 2,
      productId: productA,
      parentLineId: parent.id,
    });
    const [row] = await rows<{
      parent_line_id: string;
      product_id: string | null;
      quantity: string;
      vat_rate: string;
    }>(
      db,
      // The counts are read back to pin the raw helper's scales: written as `1` and `10` they
      // would store a thousandth of a unit at a hundredth of a percent, and no CHECK refuses
      // either. Cast to text so the assertion does not turn on how the driver renders the integer.
      sql`select parent_line_id, product_id, cast(quantity as text) as quantity,
                 cast(vat_rate as text) as vat_rate
            from working_order_lines where id = ${child.id}`,
    );
    expect(row.parent_line_id).toBe(parent.id);
    expect(row.product_id).toBe(productA);
    expect(row.quantity).toBe("1000");
    expect(row.vat_rate).toBe("1000");
  });

  it("refuses to delete a product an open order's child line names, and allows one nothing names", async () => {
    const orderId = await openOrder(db);
    const [parent] = await insertLine({ workingOrderId: orderId, lineNo: 1, productId: productA });
    const [child] = await insertLine({
      workingOrderId: orderId,
      lineNo: 2,
      productId: productA,
      parentLineId: parent.id,
    });
    const error = await captureError(() => db.delete(products).where(eq(products.id, productA)));
    // `ON DELETE restrict`, not SET NULL: a live basket line must keep naming what the kitchen is
    // cooking. SQLite names no constraint in a foreign-key refusal, so the code separates a
    // RESTRICT reference from a NO ACTION one, the message excludes a trigger's `RAISE(ABORT)`,
    // and the last step of this case attributes the refusal.
    expect(isRefusal(error, RESTRICT_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toBe("FOREIGN KEY constraint failed");

    // The control, in the other direction: an unnamed product deletes, so the refusal above is the
    // reference and not the delete itself failing.
    const [spare] = await db
      .insert(products)
      .values({
        catalogueId: (await db.select({ id: catalogues.id }).from(catalogues))[0]!.id,
        name: "Café solo",
        pricingUnit: "each",
        unitPrice: 130,
        vatClass: "general",
      })
      .returning({ id: products.id });
    await db.delete(products).where(eq(products.id, spare.id));
    expect(await db.select({ id: products.id }).from(products)).toHaveLength(1);

    // Attribution: the SAME product deletes once the two lines naming it are gone, so what
    // refused above was those lines. Child before parent — the self-link is `ON DELETE no action`.
    await db.delete(workingOrderLines).where(eq(workingOrderLines.id, child.id));
    await db.delete(workingOrderLines).where(eq(workingOrderLines.id, parent.id));
    await db.delete(products).where(eq(products.id, productA));
    expect(await db.select({ id: products.id }).from(products)).toHaveLength(0);
  });

  it("defaults option_snapshots to an empty list and refuses a null", async () => {
    const orderId = await openOrder(db);
    const [line] = await insertLine({ workingOrderId: orderId, lineNo: 1, productId: productA });
    // Drizzle for the READ: a raw select hands back the string `[]`, and only drizzle's read
    // mapping decodes it to an array.
    const [row] = await db
      .select({ optionSnapshots: workingOrderLines.optionSnapshots })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.id, line.id));
    expect(row!.optionSnapshots).toEqual([]);
    // Raw SQL for the refusal: drizzle would refuse a null at the type level before the engine
    // saw it.
    const error = await captureError(() =>
      db.execute(sql`update working_order_lines set option_snapshots = null where id = ${line.id}`),
    );
    expect(engineErrorMessage(error)).toContain("option_snapshots");
  });
});
