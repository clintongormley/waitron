import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { captureError, pgErrorCode, pgErrorMessage } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { catalogues, optionGroupItems, optionGroups } from "./catalogue.js";
import { tenants } from "./tenants.js";

// Real Postgres, not PGlite, and not describeEachTarget: this suite proves the RLS-needs-nothing
// receipt for the new products.image column (design §5a). It writes and reads image as the
// NON-OWNER app role, under withTenant + asAppUser, so the INSERT exercises the table-level
// SELECT/INSERT/UPDATE grant (0027) and the WITH CHECK half of products_tenant_isolation, and the
// SELECT exercises the USING half. A table-level GRANT (no column list) and a row policy (which
// filters rows, not columns) both extend to a column added later — this proves it rather than
// asserting it from reading. PGlite connects as a superuser that bypasses FORCE ROW LEVEL SECURITY,
// so the same assertions there would be a false pass (CLAUDE.md §4). Mirrors daily-closes.rls.test.ts.

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
// A content-addressed filename shape (<64hex>.webp) — the value the upload route will store. Its
// content does not matter to this suite; only that a non-null image survives the app role's
// INSERT + SELECT and is invisible from another tenant's GUC.
const IMAGE = `${"a".repeat(64)}.webp`;

describe("products.image under real row-level security", () => {
  const suite = useTemplateDb({ template: "core" });

  let catalogueId = "";

  beforeAll(async () => {
    const admin = suite.admin;
    await admin.insert(tenants).values([
      { id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" },
      { id: TENANT_B, country: "ES", taxId: "B11111111", legalName: "Fixture Tenant B" },
    ]);
    // The catalogue is scaffolding, seeded as the owner (RLS bypassed — pure setup). The PRODUCT
    // below is written as the app role, so it — not this — exercises the grant + policy for the new
    // column.
    const [catalogue] = await admin
      .insert(catalogues)
      .values({ tenantId: TENANT_A, name: "Deli A" })
      .returning({ id: catalogues.id });
    catalogueId = catalogue!.id;
  });

  it("lets the app role write and read back a product's image (grant + WITH CHECK + USING)", async () => {
    // The design §5a receipt, proven not asserted: insert a non-null image as app_user under A's
    // GUC (the table-level grant + the policy's WITH CHECK), then read it back (the grant + the
    // policy's USING). Raw SQL so the RED phase fails on `column "image" ... does not exist` — the
    // real cause — rather than a drizzle-schema mismatch.
    const image = await withTenant(suite.admin, TENANT_A, async (tx) => {
      await asAppUser(tx);
      await tx.execute(sql`
        insert into products
          (tenant_id, catalogue_id, descriptions, pricing_unit, unit_price, vat_class, image)
        values
          (${TENANT_A}, ${catalogueId}, '{"en":"water"}'::jsonb, 'each', '1.50', 'general', ${IMAGE})`);
      const result = await tx.execute<{ image: string | null }>(
        sql`select image from products where catalogue_id = ${catalogueId}`,
      );
      return result.rows[0]?.image;
    });
    expect(image).toBe(IMAGE);
  });

  it("hides another tenant's product image under the isolation policy", async () => {
    // The differential half of the receipt: the SAME app role, holding the SAME SELECT grant,
    // scoped to tenant B, sees NONE of tenant A's products — the image included. The positive read
    // above is load-bearing: without it, B's empty result could equally mean the app role has no
    // access at all. Drops to a false read if asAppUser is removed — a superuser bypasses the policy
    // and would see A's row from B's GUC.
    const seenByB = await withTenant(suite.admin, TENANT_B, async (tx) => {
      await asAppUser(tx);
      return tx.execute<{ image: string | null }>(
        sql`select image from products where image = ${IMAGE}`,
      );
    });
    expect(seenByB.rows).toEqual([]);
  });
});

// The three modifier-authoring tables (option_groups, option_group_items, product_option_groups) are
// tenant-scoped and carry FORCE ROW LEVEL SECURITY + a `<t>_tenant_isolation` policy + app_user grants
// exactly like catalogues/categories/products (0027). option_group_items is the representative table
// here: it inserts + reads back as the NON-OWNER app role under withTenant + asAppUser, so the INSERT
// exercises the table-level grant and the WITH CHECK half of the policy, and the SELECT exercises the
// USING half. PGlite runs as a superuser that bypasses FORCE, so this must be real Postgres.
const OG_TENANT_A = "33333333-3333-4333-8333-333333333333";
const OG_TENANT_B = "44444444-4444-4444-8444-444444444444";
const optionSuite = useTemplateDb({ template: "core" });

describe("option_group_items under real row-level security", () => {
  // group_id of a group owned by tenant A, seeded as the owner (RLS bypassed — pure scaffolding). The
  // ITEM below is written as the app role, so it — not this — exercises the grant + policy.
  let groupA = "";

  beforeAll(async () => {
    const admin = optionSuite.admin;
    await admin.insert(tenants).values([
      { id: OG_TENANT_A, country: "ES", taxId: "B22222222", legalName: "Fixture Tenant OG-A" },
      { id: OG_TENANT_B, country: "ES", taxId: "B33333333", legalName: "Fixture Tenant OG-B" },
    ]);
    const [group] = await admin
      .insert(optionGroups)
      .values({ tenantId: OG_TENANT_A, name: { en: "Size" } })
      .returning({ id: optionGroups.id });
    groupA = group!.id;
  });

  it("lets the app role write and read back its own tenant's option_group_item (grant + WITH CHECK + USING)", async () => {
    // Insert an item under A's GUC as app_user (the table-level grant + the policy's WITH CHECK), then
    // read every visible item back (the grant + the policy's USING). Raw SQL so the RED phase fails on
    // `relation "option_group_items" does not exist` rather than a drizzle-schema mismatch.
    const { rows, item } = await withTenant(optionSuite.admin, OG_TENANT_A, async (tx) => {
      await asAppUser(tx);
      await tx.execute(sql`
        insert into option_group_items (tenant_id, group_id, name, price_delta)
        values (${OG_TENANT_A}, ${groupA}, '{"en":"Large"}'::jsonb, '1.50')`);
      const result = await tx.execute<{ tenant_id: string }>(
        sql`select tenant_id from option_group_items`,
      );
      // The allergen-overlay round-trip: a nullable add_allergens + a non-null remove_allergens
      // string[], written and read back as the app role. Proves the two additive JSONB columns ride
      // on option_group_items' existing grant + WITH CHECK + USING with no RLS change (design §4).
      const [overlayItem] = await tx
        .insert(optionGroupItems)
        .values({
          tenantId: OG_TENANT_A,
          groupId: groupA,
          name: { en: "Gluten-free bun" },
          addAllergens: null,
          removeAllergens: ["gluten"],
        })
        .returning();
      return { rows: result.rows, item: overlayItem };
    });
    expect(rows.length).toBe(1);
    expect(rows.every((r) => r.tenant_id === OG_TENANT_A)).toBe(true);
    expect(item!.removeAllergens).toEqual(["gluten"]);
    expect(item!.addAllergens).toBeNull();
  });

  it("hides another tenant's option_group_items under the isolation policy", async () => {
    // The differential half: the SAME app role scoped to tenant B, holding the SAME SELECT grant, sees
    // NONE of tenant A's items. The positive read above makes this load-bearing — without it B's empty
    // result could equally mean no access at all. A superuser (asAppUser removed) would see A's row.
    const seenByB = await withTenant(optionSuite.admin, OG_TENANT_B, async (tx) => {
      await asAppUser(tx);
      return tx.execute(sql`select tenant_id from option_group_items`);
    });
    expect(seenByB.rows).toEqual([]);
  });
});

// option_group_items.max_quantity: the AUTHORED per-option cap (design: per-option quantity). Real
// Postgres, not PGlite, because the receipts are a column DEFAULT and a CHECK constraint — a default
// is server-side and a check only fires in a real backend. Seeded and inserted as the OWNER (RLS
// bypassed): this suite proves the default value and the check, not the grant/policy those are the
// job of the isolation suite above. `describeEachTarget` is unnecessary — the behaviour is not
// RLS-role-dependent.
const QTY_TENANT = "55555555-5555-4555-8555-555555555555";
const qtySuite = useTemplateDb({ template: "core" });

describe("option_group_items.max_quantity default and check constraint", () => {
  let qtyGroup = "";

  beforeAll(async () => {
    const admin = qtySuite.admin;
    await admin.insert(tenants).values({
      id: QTY_TENANT,
      country: "ES",
      taxId: "B44444444",
      legalName: "Fixture Tenant QTY",
    });
    const [group] = await admin
      .insert(optionGroups)
      .values({ tenantId: QTY_TENANT, name: { en: "Extras" } })
      .returning({ id: optionGroups.id });
    qtyGroup = group!.id;
  });

  it("defaults max_quantity to 1 when the insert omits it", async () => {
    // Raw SQL that lists no max_quantity column, so the RED phase fails on `column "max_quantity"
    // ... does not exist` when the SELECT runs — the real cause — rather than a drizzle mismatch.
    const [row] = (
      await qtySuite.admin.execute<{ max_quantity: number }>(sql`
        insert into option_group_items (tenant_id, group_id, name, price_delta)
        values (${QTY_TENANT}, ${qtyGroup}, '{"en":"Cheese"}'::jsonb, '0.50')
        returning max_quantity`)
    ).rows;
    expect(row?.max_quantity).toBe(1);
  });

  it("rejects an insert of max_quantity = 0 with the check constraint", async () => {
    // The real SQLSTATE and constraint name live on the driver error's `.cause`, not on
    // DrizzleQueryError's own `Failed query: <sql>` message — so read them with pgErrorCode/
    // pgErrorMessage rather than matching the wrapper text (which would pass on any thrown error).
    const error = await captureError(() =>
      qtySuite.admin.execute(sql`
        insert into option_group_items (tenant_id, group_id, name, price_delta, max_quantity)
        values (${QTY_TENANT}, ${qtyGroup}, '{"en":"Bacon"}'::jsonb, '1.00', 0)`),
    );
    expect(pgErrorCode(error)).toBe("23514"); // check_violation
    expect(pgErrorMessage(error)).toMatch(/option_group_items_qty_ck/);
  });
});

describe("row-level security is enabled AND forced on the option tables", () => {
  it("has relrowsecurity and relforcerowsecurity on all three option tables", async () => {
    // ENABLE alone (drizzle's .enableRLS()) leaves the owner and every superuser exempt; FORCE (the
    // hand-written --custom migration) is what binds the deployment role. Deleting any FORCE line drops
    // relforcerowsecurity to false and fails this — the guard the fiscal `inmutabilidad` suite also
    // enforces tree-wide.
    const result = await optionSuite.admin.execute<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(sql`
      select relname, relrowsecurity, relforcerowsecurity
      from pg_class
      where relname in ('option_groups', 'option_group_items', 'product_option_groups')
      order by relname`);
    expect(result.rows).toEqual([
      { relname: "option_group_items", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "option_groups", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "product_option_groups", relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });
});
