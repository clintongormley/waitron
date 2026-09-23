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
    // Fixture cleanup must remove lines whose parent is already terminal, which
    // `working_order_lines_require_open_parent_delete` refuses — measured on this package's
    // migrated database, that trigger really is BEFORE DELETE and really does raise
    // `lines may only be written while the order is open`.
    //
    // This block used to read `set local session_replication_role = 'replica'`, which skipped
    // PostgreSQL's origin-only triggers for the rest of the transaction. Run against this engine
    // that statement is refused at prepare with `near "set": syntax error` (node v26.7.0,
    // `node:sqlite`) and took the WHOLE FILE down with it: the cleanup threw, the fixture tables
    // survived, and all twenty-nine cases failed — the later ones on
    // `UNIQUE constraint failed: tenants.id` from the previous case's leftover row.
    //
    // There is no session-level trigger switch here, so the trigger is dropped and put back
    // instead. Its own statement is read out of `sqlite_master` and replayed verbatim rather than
    // written out again here, so a future edit to the migration cannot leave this fixture
    // restoring a stale definition — the idiom `packages/fiscal-verifactu/src/verify.test.ts`
    // uses. It is inside the transaction, so a cleanup that throws rolls the drop back too.
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

// working_order_lines.product_id carries a foreign key to products (park & retrieve, Task 1). Both
// kinds of line name a product today: a parent names the dish and a child extra line names the
// PICKED product. The column stays nullable (see the schema comment on it), but nothing here
// exercises that. seed() creates one priced product and stores its id here; the LINE fixture uses
// it.
let productA = "";
// order_number is NOT NULL on working_orders. No UNIQUE constraint yet (the per-node allocator is a
// later task), so a simple ascending counter keeps every fixture order distinct without one.
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
  // One priced product — the FK target every draft line now needs.
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

// The shared line fixture; callers pass the tenant's product via productId.
const LINE = {
  lineNo: 1,
  name: "Café solo",
  descriptions: { es: "Café solo", ca: "Cafè sol" },
  // One unit, in whole thousandths (`quantity()` in packages/db/src/schema/columns.ts).
  quantity: 1000,
  unitPrice: 130,
  // The GROSS (VAT-inclusive) unit locked at add time (unit_price_gross, 7c): 1.30 net at 10% VAT,
  // in whole cents.
  unitPriceGross: 143,
  // 10.00%, in whole basis points (`rate()` in the same file). It is the same number as the
  // quantity above meaning something else, which is why the two scales have separate converters.
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
    // The column was a PostgreSQL enum TYPE and is now TEXT under a named CHECK listing the four
    // statuses (`working_orders_status_ck`, drizzle/0000_baseline.sql). The refusal survives the
    // change of mechanism, so this pins the CHECK class and the constraint's name instead of the
    // enum type's name — measured on this case: errcode 275,
    // `CHECK constraint failed: working_orders_status_ck`.
    const error = await captureError(() =>
      db.execute(
        // The two `::` casts this statement carried are gone: SQLite has no cast operator, and run
        // as written the statement was refused at prepare with `unrecognized token: ":"` (node
        // v26.7.0, `node:sqlite`) — so the refusal this case is about was never reached. Both
        // columns are TEXT here, and the bound values are already the strings they hold. `id` and
        // `order_number` are named explicitly too: both are NOT NULL and `id` is a `$defaultFn`
        // generator, so with the cast removed but the columns still omitted this statement was
        // refused `NOT NULL constraint failed: working_orders.order_number` and never reached the
        // status CHECK this case is about (measured on this case).
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
    // open → open is the ordinary case and must stay cheap: a table adds a
    // round of drinks four times before it asks for the bill.
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

  // WHAT THE SIX TRANSITION CASES BELOW LOST. The PostgreSQL guard interpolated both states into
  // its message (`cannot transition from settled to open`), so each case pinned the states the
  // trigger had read as well as the refusal. `working_orders_enforce_transition` now raises ONE
  // fixed sentence for every refused transition (`TRANSITION_REFUSAL`, ../trigger-refusals.ts), so
  // the states are not in the error at all and no assertion here can reach them. Everything else
  // each case pins is unchanged: the transition it drives is refused, and refused by THIS trigger
  // — `triggerRaised` matches the class and the exact words, which excludes an `ON DELETE
  // RESTRICT` refusal (same result code 1811, different message) and every other trigger's raise.
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
    // The illegal transitions are the ones worth testing. A state machine
    // tested only on its happy path is a comment.
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
    // The symmetric case of the settled one above: the guard checks
    // OLD.status itself rather than branching per terminal state, so this is
    // very likely redundant with it — but "terminal means terminal" should be
    // demonstrated for both terminal states, not just one of them.
    const id = await openOrder(db);
    await db.update(workingOrders).set({ status: "abandoned" }).where(eq(workingOrders.id, id));
    const error = await captureError(() =>
      db.update(workingOrders).set({ tillId: TILL_A1 }).where(eq(workingOrders.id, id)),
    );
    expect(triggerRaised(error, TRANSITION_REFUSAL)).toBe(true);
  });

  it("carries a nullable node_id column referencing nodes", async () => {
    // Node rekey scaffolding (Task 3): node_id is added NULLABLE with a plain FK to `nodes`, and
    // working_orders stays nullable permanently in this slice — no writer yet (design §5).
    const node = await seedNode(db, brandLocationId(LOCATION_A));
    // `pragma_table_info` for `information_schema.columns`, which does not exist on this engine —
    // run as written this statement died with `no such table: information_schema.columns`. Its
    // `notnull` is 1 for a NOT NULL column and 0 otherwise, the exact counterpart of
    // `is_nullable`'s 'NO'/'YES', so the assertion carries across unchanged.
    const meta = await rows<{ notnull: number }>(
      db,
      sql`select "notnull" from pragma_table_info('working_orders') where name = 'node_id'`,
    );
    expect(meta).toEqual([{ notnull: 0 }]);
    // Opens fine WITHOUT node_id (nullable) ...
    const plainId = await openOrder(db);
    const [plain] = await db.select().from(workingOrders).where(eq(workingOrders.id, plainId));
    expect(plain.nodeId).toBeNull();
    // ... and accepts a valid node id when set.
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
    // The whole message is `FOREIGN KEY constraint failed` — SQLite names neither the constraint
    // nor the column, so the CLASS is all there is to assert (measured on this case: errcode 787,
    // `constraintTarget` undefined). That is what the PostgreSQL regex pinned too: it matched
    // `violates foreign key constraint` and read no name out of it either.
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
    // The key itself, not just the class: SQLite names the table and the colliding columns in the
    // message, so this pins `working_order_lines_line_no_key`'s (working_order_id, line_no) rather
    // than accepting any uniqueness refusal on this table — `id`'s primary key would satisfy the
    // class alone. Measured on this case: errcode 2067,
    // `UNIQUE constraint failed: working_order_lines.working_order_id, working_order_lines.line_no`.
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
    // The mutable draft keeps product_id — the dish's on a top-level line (the chosen variant when
    // one was chosen, spec §4.3), the PICKED extra's on a child line. Names and prices are
    // snapshotted by value, so the identifier lets no catalogue edit change a completed record. The
    // extras and options a line answered point at nothing: `option_snapshots` holds names, and a
    // pick becomes a child line naming its product.
    // `pragma_table_info` for `information_schema.columns`; it reports the same column NAMES, and
    // names are all this case reads, so nothing changes about what it catches.
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
    // `pragma_table_info` for `information_schema.columns`. Three of the four values carry across:
    // the name, the declared type, and `notnull` 0 for `is_nullable` 'YES'. The fourth, `udt_name`,
    // was PostgreSQL's underlying TYPE name and has no counterpart in the pragma at all — for this
    // column it said `text`, the same word as `data_type`, so nothing it separated is separated
    // elsewhere in this case. `lower(type)` because the pragma answers `TEXT` in upper case while
    // the `CREATE TABLE` statement `sqlite_master` holds spells it `text` (measured on this
    // package's migrated database).
    const meta = await rows<{ name: string; type: string; notnull: number }>(
      db,
      sql`select name, lower(type) as type, "notnull" from pragma_table_info('working_order_lines')
           where name = 'note'`,
    );
    expect(meta).toEqual([{ name: "note", type: "text", notnull: 0 }]);
  });

  it("stores every monetary column as integer, a whole count of cents", async () => {
    // WHAT THIS CASE LOST. It read four values out of `information_schema.columns`, which does not
    // exist on this engine — run as written the statement died with
    // `no such table: information_schema.columns`. `pragma_table_info` is the replacement, and it
    // reports a name, a declared type and `notnull`; there is no `numeric_precision` and no
    // `numeric_scale`, so TWO of the three assertions below have no counterpart and are gone.
    //
    // The comment they carried named two faults: a column slipping back to `numeric(12, 2)`, and
    // one narrowed to a four-byte integer. Neither is a shape this engine can take — SQLite has no
    // fixed-point numeric type, and its INTEGER storage class is one thing rather than a family of
    // widths. So what those two assertions watched for is not available to be watched, rather than
    // being watched less carefully.
    //
    // What is still checked: that all three columns exist, and that each is INTEGER rather than
    // TEXT — which is what a money column being a whole count of cents means here
    // (`money()` in packages/db/src/schema/columns.ts). CLAUDE.md §3 states the hedge that goes
    // with it: `money`, `quantity` and `bigCount` all emit the same SQL type, so this pins the
    // storage class and NOT the unit.
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

/**
 * The links on the MUTABLE draft line:
 *
 * - `parent_line_id` — a self-link so an extra is its own child line pointing at the dish line it
 *   belongs to. (parent_line_id) → working_order_lines(id), MATCH SIMPLE so a top-level line (NULL)
 *   passes.
 * - `product_id` — the dish's on a top-level line and the PICKED product's on a child line, under
 *   one `ON DELETE restrict` FK, so a product either kind of line names cannot be deleted while the
 *   line exists (asserted below). The column is NULLABLE — a line naming NO product inserts, which
 *   no case here exercises — but not in order to survive a deleted product, because `restrict`
 *   makes that deletion impossible. It has no bearing on the parent FK, which is a separate constraint on a separate
 *   column (working_order_lines_parent_fk, 0034_drop_tenant_id_after_sql.sql).
 * - `option_snapshots` — the dish's frozen options answers, NOT NULL and defaulting to an empty list.
 *   It names no list and no label, so deleting either cannot reach a saved order.
 */
describe("working_order_lines — the draft line's links", () => {
  let db: Database;

  beforeEach(async () => {
    db = suite.db;
    await seed(db);
  });

  // Raw insert so a missing column fails here rather than as a TypeScript error against the drizzle
  // `workingOrderLines` type. product_id is passed explicitly (NULL for a line naming no product).
  //
  // Two changes the engine forced, neither of which touches what the cases below assert. The
  // `${descriptions}::jsonb` cast is gone — SQLite has no cast operator and the statement was
  // refused at prepare with `unrecognized token: ":"` (node v26.7.0, `node:sqlite`); the column is
  // TEXT holding JSON, so the bound string is already what it stores. And `id` is now passed
  // explicitly, because `working_order_lines.id` is `$defaultFn(newId)` — a JavaScript generator
  // rather than a SQL DEFAULT, which a raw insert never reaches. Supplying it here keeps the
  // insert raw, which is the whole point of this helper.
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
    // A child extra line: the PICKED product, linked to the parent dish line.
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
      // The two scaled counts are read back, which is what pins the raw helper above: written as
      // `1` and `10` — the whole-unit spelling the decimal columns took — the insert succeeds and
      // stores a thousandth of a unit at a hundredth of a percent, refused by neither
      // `working_order_lines_quantity_ck` nor `working_order_lines_vat_rate_ck`. Measured by
      // putting those two literals back and running this case. Rendered as text so the assertion
      // does not turn on how the driver renders each of the two integer widths — `cast(x as text)`
      // for the `x::text` this was written as, because SQLite has no cast OPERATOR but does have
      // the standard cast EXPRESSION. The `${child.id}::uuid` cast is simply gone: the column is
      // TEXT and the bound value is already the string it holds.
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
    // cooking (spec §3.5).
    //
    // WHAT THIS LOST. It named the constraint — `working_order_lines_product_fk` — and SQLite
    // reports no constraint name for a foreign key: the whole message is `FOREIGN KEY constraint
    // failed` (measured on this case, errcode 1811). The name still exists in the drizzle schema
    // (../orders.ts) and in the snapshots, but it is not in the refusal, so no assertion can read
    // it. Two things stand in for it, and neither is the name:
    //  - the result code separates a RESTRICT reference from the schema's other kind. SQLite
    //    implements `ON DELETE RESTRICT` with an internal trigger, so it arrives as 1811
    //    (`RESTRICT_VIOLATION`) while an `ON DELETE NO ACTION` parent-delete arrives as 787 —
    //    `products` carries one reference of each (working_order_lines restrict, recipe_lines no
    //    action). Measured with one real refusal of each against `node:sqlite` on node v26.7.0.
    //  - the message, which excludes a trigger's own `RAISE(ABORT)`: those share code 1811 and
    //    report their own words instead (../sql-state.ts's `TRIGGER_ABORT`).
    // The last step of this case closes the gap behaviourally.
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

    // Attribution, which is what the constraint name used to give and the refusal no longer can:
    // the SAME product deletes once the two lines naming it are gone, so what refused above was
    // those lines and not some other reference onto `products`. Child before parent — the
    // self-link is `ON DELETE no action`, so removing the parent first would dangle the child.
    await db.delete(workingOrderLines).where(eq(workingOrderLines.id, child.id));
    await db.delete(workingOrderLines).where(eq(workingOrderLines.id, parent.id));
    await db.delete(products).where(eq(products.id, productA));
    expect(await db.select({ id: products.id }).from(products)).toHaveLength(0);
  });

  it("defaults option_snapshots to an empty list and refuses a null", async () => {
    const orderId = await openOrder(db);
    const [line] = await insertLine({ workingOrderId: orderId, lineNo: 1, productId: productA });
    // Drizzle for the READ, not raw SQL. `option_snapshots` is a `json(...)` column stored as
    // TEXT, so a raw select hands back the string `[]` and `toEqual([])` fails on it; only
    // drizzle's read mapping decodes it to the array this case is about. Measured on this case.
    const [row] = await db
      .select({ optionSnapshots: workingOrderLines.optionSnapshots })
      .from(workingOrderLines)
      .where(eq(workingOrderLines.id, line.id));
    expect(row!.optionSnapshots).toEqual([]);
    // The refusal stays on a raw statement — it is the NOT NULL the column carries that is under
    // test, and drizzle would refuse a null at the type level before the engine saw it. The
    // `::uuid` cast is gone for the reason the helper above records.
    const error = await captureError(() =>
      db.execute(sql`update working_order_lines set option_snapshots = null where id = ${line.id}`),
    );
    expect(engineErrorMessage(error)).toContain("option_snapshots");
  });
});
