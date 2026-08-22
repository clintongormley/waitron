import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import type { Transaction } from "../client.js";
import { captureError, pgErrorCode, pgErrorMessage } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { seedNode } from "../testing/seed.js";
import { withTenant } from "../tenancy.js";
import { catalogues, products } from "./catalogue.js";
import { locations, tenants, tills } from "./tenants.js";

// Real Postgres, not PGlite, and not describeEachTarget: this suite asserts the
// `working_orders_enforce_transition` trigger's behaviour under the non-owner `app_user` role — the
// deployment role a real venue runs as. A trigger is behavioural DDL that would fire on PGlite too,
// so the state-machine assertions here would pass on either target; but PGlite runs EVERY connection
// as a superuser, and this suite deliberately transitions rows as `app_user` under RLS so the pass
// is evidence about the role that will actually run these statements. Keeping it real also lets it
// ride the one container the sibling `park-retrieve.rls.test.ts` already needs for its FORCE-RLS
// check (CLAUDE.md §4, mirroring that file's comment).

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const AT = "2026-07-20T19:20:30+00:00";
// Café solo / Cafè sol is this package's placeholder line description (orders.test.ts, sales.test.ts,
// park-retrieve.rls.test.ts): both literals pass english-only.ts's SPANISH_WORDS guard, and they
// match LOCATION_A's configured invoice_locales (es, ca) so check_locales lets the draft line reach
// require_open_parent — the trigger this suite's composition-freeze case exercises.
const DESCRIPTIONS_A = JSON.stringify({ es: "Café solo", ca: "Cafè sol" });

// Captured at seed time — the ids the raw inserts below need for tenant-consistent FKs.
let nodeA = "";
let productA = "";
// working_orders carries no UNIQUE on order_number in this slice (the allocator owns distinctness),
// but a fresh number per order keeps each fixture independent of the others.
let nextOrderNumber = 1;

describe("working_orders state machine (enforce_transition)", () => {
  const suite = useTemplateDb({ template: "core" });

  // Every transition/line write under test runs through here: tenant A's GUC set, then SET ROLE
  // app_user — the deployment role, under RLS. The seed (below) and open() run as the owner instead.
  function asApp<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(suite.admin, TENANT_A, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });
  }

  // Inserts one `open` working order as the owner (superuser bypasses RLS — pure setup, exactly like
  // park-retrieve's openOrder). node_id is set (design §5: every counter order carries one), which
  // also exercises the composite working_orders_node_fk.
  async function open(): Promise<string> {
    const orderNumber = nextOrderNumber++;
    const result = await suite.admin.execute<{ id: string }>(
      sql`insert into working_orders (tenant_id, till_id, node_id, order_number, status, opened_at)
          values (${TENANT_A}, ${TILL_A1}, ${nodeA}, ${orderNumber}, 'open', ${AT}) returning id`,
    );
    return result.rows[0]!.id;
  }

  // A valid draft line while the parent is open, written as app_user so require_open_parent (and
  // check_locales) fire under the deployment role. unit_price_gross is NOT NULL since 0030.
  function insertLine(orderId: string, lineNo: number): Promise<unknown> {
    return asApp((tx) =>
      tx.execute(
        sql`insert into working_order_lines
              (tenant_id, working_order_id, line_no, product_id, descriptions,
               quantity, unit_price, unit_price_gross, vat_rate, line_total)
            values (${TENANT_A}, ${orderId}, ${lineNo}, ${productA}, ${DESCRIPTIONS_A}::jsonb,
               '1.000', '1.00', '1.10', '10.00', '1.00')`,
      ),
    );
  }

  // Common scaffolding seeded once as the owner (superuser bypasses RLS — pure setup). Registered
  // after the helper's own hook, which vitest runs first; if it throws this one never runs, so
  // `suite.admin` is never read unstarted (verified pattern, park-retrieve.rls.test.ts).
  beforeAll(async () => {
    const admin = suite.admin;
    await admin
      .insert(tenants)
      .values([{ id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
    await admin.insert(locations).values([
      {
        id: LOCATION_A,
        tenantId: TENANT_A,
        name: "Fixture Location A",
        invoiceLocales: ["es", "ca"],
        operationDescription: "Hostelería",
      },
    ]);
    await admin
      .insert(tills)
      .values([{ id: TILL_A1, tenantId: TENANT_A, locationId: LOCATION_A, name: "A1" }]);
    nodeA = await seedNode(admin, brandTenantId(TENANT_A), brandLocationId(LOCATION_A));
    const [catalogue] = await admin
      .insert(catalogues)
      .values({ tenantId: TENANT_A, name: "Deli" })
      .returning({ id: catalogues.id });
    const [product] = await admin
      .insert(products)
      .values({
        tenantId: TENANT_A,
        catalogueId: catalogue.id,
        descriptions: { es: "Café solo", ca: "Cafè sol" },
        pricingUnit: "each",
        unitPrice: "1.00",
        vatClass: "general",
      })
      .returning({ id: products.id });
    productA = product.id;
  });

  it("permits open → placed, placed → settled, and open → open (label edit)", async () => {
    const id = await open();
    // open → open: a label edit keeps status open. 'Table 4' rather than the design's 'Mesa 4' —
    // `mesa` is in english-only.ts's SPANISH_WORDS, which scans string literals in this file too.
    await asApp((tx) =>
      tx.execute(sql`update working_orders set label = 'Table 4' where id = ${id}`),
    );
    // open → placed: placing (composition now frozen).
    await asApp((tx) =>
      tx.execute(sql`update working_orders set status = 'placed' where id = ${id}`),
    );
    // placed → settled: collect. settled_at satisfies the settled_at biconditional.
    await asApp((tx) =>
      tx.execute(
        sql`update working_orders set status = 'settled', settled_at = now() where id = ${id}`,
      ),
    );
    const [row] = await asApp((tx) =>
      tx
        .execute<{ status: string }>(sql`select status from working_orders where id = ${id}`)
        .then((r) => r.rows),
    );
    expect(row!.status).toBe("settled");
  });

  it("permits open → placed → abandoned", async () => {
    const id = await open();
    await asApp((tx) =>
      tx.execute(sql`update working_orders set status = 'placed' where id = ${id}`),
    );
    // placed → abandoned: cancel. settled_at stays null, so the biconditional holds.
    await asApp((tx) =>
      tx.execute(sql`update working_orders set status = 'abandoned' where id = ${id}`),
    );
    const [row] = await asApp((tx) =>
      tx
        .execute<{ status: string }>(sql`select status from working_orders where id = ${id}`)
        .then((r) => r.rows),
    );
    expect(row!.status).toBe("abandoned");
  });

  it("permits open → settled directly (the Mode-P walk-up, never entering placed)", async () => {
    // The #60 cash-sale path (design §3, §5): a walk-up order settles in one instant without ever
    // being placed. open → settled is an allowed edge in its own right, so this must NOT require a
    // placed intermediate. settled_at is set alongside status to satisfy the settled_at biconditional.
    const id = await open();
    await asApp((tx) =>
      tx.execute(
        sql`update working_orders set status = 'settled', settled_at = now() where id = ${id}`,
      ),
    );
    const [row] = await asApp((tx) =>
      tx
        .execute<{ status: string }>(sql`select status from working_orders where id = ${id}`)
        .then((r) => r.rows),
    );
    expect(row!.status).toBe("settled");
  });

  it("rejects every transition out of settled/abandoned", async () => {
    const id = await open();
    await asApp((tx) =>
      tx.execute(
        sql`update working_orders set status = 'settled', settled_at = now() where id = ${id}`,
      ),
    );
    // The status flip AND the settled_at reset both satisfy the settled_at biconditional, so the
    // ONLY thing that can reject this is the trigger treating settled as terminal — P0001, the
    // RAISE EXCEPTION's SQLSTATE (no custom code).
    const e1 = await captureError(() =>
      asApp((tx) =>
        tx.execute(
          sql`update working_orders set status = 'abandoned', settled_at = null where id = ${id}`,
        ),
      ),
    );
    expect(pgErrorCode(e1)).toBe("P0001");

    // Even a non-status column change on an abandoned row is rejected — the trigger keys on
    // OLD.status, not on whether status itself moved.
    const id2 = await open();
    await asApp((tx) =>
      tx.execute(sql`update working_orders set status = 'abandoned' where id = ${id2}`),
    );
    const e2 = await captureError(() =>
      asApp((tx) => tx.execute(sql`update working_orders set label = 'x' where id = ${id2}`)),
    );
    expect(pgErrorCode(e2)).toBe("P0001");
  });

  it("permits a collected_at NULL→non-null stamp on a settled order (the Mode-P handover marker, 0056)", async () => {
    // A Mode-P walk-up settles BEFORE it is fired, so its order-level `collected_at` handover marker
    // (KDS-1 §3e) can only be written by a settled → settled UPDATE — the ONE relaxation 0056 adds to
    // `enforce_transition`. Nothing else about the settled row changes, so the trigger permits exactly
    // this stamp (the fiscal record was filed at settle and is untouched). settled_at is set alongside
    // status to satisfy the settled_at biconditional.
    const id = await open();
    await asApp((tx) =>
      tx.execute(
        sql`update working_orders set status = 'settled', settled_at = now() where id = ${id}`,
      ),
    );
    await asApp((tx) =>
      tx.execute(sql`update working_orders set collected_at = now() where id = ${id}`),
    );
    const [row] = await asApp((tx) =>
      tx
        .execute<{ collected: boolean }>(
          sql`select (collected_at is not null) as collected from working_orders where id = ${id}`,
        )
        .then((r) => r.rows),
    );
    expect(row!.collected).toBe(true);
  });

  it("rejects any OTHER change to a settled order, and a re-stamp of an already-collected one (0056 keeps the settled-state freeze)", async () => {
    // The 0056 relaxation permits the collected_at stamp and NOTHING ELSE — every other working_orders
    // column is pinned with IS NOT DISTINCT FROM. Each rejection below is the trigger's RAISE (P0001).
    const id = await open();
    await asApp((tx) =>
      tx.execute(
        sql`update working_orders set status = 'settled', settled_at = now() where id = ${id}`,
      ),
    );
    // A settled-row change that ALSO touches another column (label) is rejected even though collected_at
    // is going NULL→non-null — the pinned label no longer matches, so no allowed branch applies. This is
    // the defense-in-depth: the fiscal-relevant identity/`settled_at` fields stay frozen.
    const eLabel = await captureError(() =>
      asApp((tx) =>
        tx.execute(
          sql`update working_orders set collected_at = now(), label = 'x' where id = ${id}`,
        ),
      ),
    );
    expect(pgErrorCode(eLabel)).toBe("P0001");
    // A settled → settled UPDATE that is NOT a collected_at stamp (a bare settled_at edit) is rejected —
    // the relaxation requires collected_at itself to go NULL→non-null.
    const eSettledAt = await captureError(() =>
      asApp((tx) => tx.execute(sql`update working_orders set settled_at = now() where id = ${id}`)),
    );
    expect(pgErrorCode(eSettledAt)).toBe("P0001");

    // Now legitimately stamp the handover marker (NULL→non-null) — allowed.
    await asApp((tx) =>
      tx.execute(sql`update working_orders set collected_at = now() where id = ${id}`),
    );
    // A re-stamp of an already-collected order (collected_at non-null → non-null) is rejected: the
    // branch's guard is OLD.collected_at IS NULL, so a second collect matches no allowed branch.
    const eRecollect = await captureError(() =>
      asApp((tx) =>
        tx.execute(sql`update working_orders set collected_at = now() where id = ${id}`),
      ),
    );
    expect(pgErrorCode(eRecollect)).toBe("P0001");
  });

  it("rejects placed → open and a non-status update of a placed row (the row-level freeze)", async () => {
    const id = await open();
    await asApp((tx) =>
      tx.execute(sql`update working_orders set status = 'placed' where id = ${id}`),
    );
    // No un-placing.
    const e1 = await captureError(() =>
      asApp((tx) => tx.execute(sql`update working_orders set status = 'open' where id = ${id}`)),
    );
    expect(pgErrorCode(e1)).toBe("P0001");
    // A label edit on a placed row is rejected too — this IS the composition freeze at the row
    // level, since placed → placed is not an allowed edge.
    const e2 = await captureError(() =>
      asApp((tx) =>
        tx.execute(sql`update working_orders set label = 'late label' where id = ${id}`),
      ),
    );
    expect(pgErrorCode(e2)).toBe("P0001");
  });

  it("rejects a line write on a placed order (composition freeze via require_open_parent)", async () => {
    const id = await open();
    await insertLine(id, 1); // valid while open — the positive control for the rejections below
    await asApp((tx) =>
      tx.execute(sql`update working_orders set status = 'placed' where id = ${id}`),
    );
    const eIns = await captureError(() => insertLine(id, 2));
    expect(pgErrorMessage(eIns)).toMatch(
      /order .* is placed|only be written while the order is open/i,
    );
    const eDel = await captureError(() =>
      asApp((tx) =>
        tx.execute(
          sql`delete from working_order_lines where working_order_id = ${id} and line_no = 1`,
        ),
      ),
    );
    expect(pgErrorMessage(eDel)).toMatch(/only be written while the order is open/i);
  });
});
