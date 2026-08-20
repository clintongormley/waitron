import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { asAppUser, withTenant } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { createIngredient } from "./ingredients.js";
import { getProductRecipe, setProductRecipe } from "./recipes.js";
import { seedProduct, seedVenue } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";

// Same probe role as ingredients.rls.test.ts — a non-superuser LOGIN role inheriting app_user's
// grants, so it is a genuine RLS subject rather than a superuser that bypasses FORCE ROW LEVEL
// SECURITY. The app_user membership grants it SELECT/INSERT/UPDATE/DELETE on `recipe_lines`
// (0039_recipes_rls.sql) — recipe_lines DOES hold DELETE (setProductRecipe replaces a product's
// lines), unlike `ingredients`, which the third test proves succeeds. current_tenant_id() reads
// `app.tenant_id`, so a read under tenant B's GUC matches none of tenant A's lines. Real Postgres,
// not PGlite, for the reason CLAUDE.md §4 gives: PGlite's superuser connection bypasses RLS and
// would make this a false pass. Mirrors packages/catalogue/src/operations.rls.test.ts. This suite and
// ingredients.rls.test.ts connect as the SAME `rls_probe`, created once cluster-wide in the package's
// globalSetup (`src/testing/global-setup.ts`) — not per file, because a shared container is one
// cluster; see that file's header.
const PROBE_ROLE = "rls_probe";
const PROBE_PASSWORD = "probe";

const suite = useTemplateDb({ template: "core" });

// A DIRECT single-table read of `recipe_lines`, bypassing the ingredients join that getProductRecipe
// uses. This is what makes the isolation assertion bite on the `recipe_lines` tenant-isolation policy
// specifically: under a tenant's GUC the count reflects ONLY that policy's USING clause, with no
// second table's policy able to mask the result. `count(*)` is bigint (node-postgres returns it as a
// string), so `::int` casts it to a JS number. Parameterised `sql` (Drizzle), never concatenation.
async function countRecipeLines(tx: Transaction): Promise<number> {
  const res = await tx.execute<{ n: number }>(sql`select count(*)::int as n from recipe_lines`);
  return res.rows[0]!.n;
}

describe("recipe_lines under real row-level security", () => {
  let tenantA: SeededVenue;
  let tenantB: SeededVenue;
  let productId: string;
  let ingredientId: string;

  beforeAll(async () => {
    // Seed both tenants as the superuser (admin); the product, ingredient and recipe line below are
    // all written as the RLS-subject probe role, scoped to tenant A, so each INSERT exercises its
    // grant and the WITH CHECK half of the isolation policy.
    tenantA = await seedVenue(suite.admin);
    tenantB = await seedVenue(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // seedProduct opens its own withTenant/asAppUser on the connection it is handed, so passing the
      // probe makes the catalogue+product write a genuine app_user (RLS-subject) insert.
      productId = await seedProduct(probe, tenantA.tenantId);
      await withTenant(probe, tenantA.tenantId, async (tx) => {
        await asAppUser(tx);
        const flour = await createIngredient(tx, {
          name: "flour",
          allergens: { gluten: { presence: "contains", source: "wheat" } },
        });
        ingredientId = flour.id;
        await setProductRecipe(tx, productId, [flour.id]);
      });
    } finally {
      await probe.close();
    }
  });

  it("isolates one tenant's recipe lines from another", async () => {
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // Positive control — tenant A, the owner, sees its own recipe line, both through the
      // getProductRecipe join (which also proves the SELECT grant landed) and as a DIRECT
      // single-table read of recipe_lines. The direct count is 1 here, 0 for tenant B below: same
      // table, same grant, only the policy's USING differs between the two — a clean single-table
      // differential.
      const own = await withTenant(probe, tenantA.tenantId, async (tx) => {
        await asAppUser(tx);
        return {
          recipe: await getProductRecipe(tx, productId),
          lineCount: await countRecipeLines(tx),
        };
      });
      expect(own.recipe.map((i) => i.name)).toEqual(["flour"]);
      expect(own.lineCount).toBe(1);

      // The LOAD-BEARING isolation assertion: a DIRECT read of recipe_lines under tenant B's GUC,
      // which sees 0 rows ONLY because of the recipe_lines tenant-isolation policy's USING clause.
      // This is what the prove-by-deletion flips — weaken recipe_lines_tenant_isolation's USING to
      // `true` and B's count becomes 1 (recorded in the Task 6 report). A getProductRecipe check here
      // would be VACUOUS: its `[]` is satisfied by the still-intact ingredients policy filtering the
      // join's inner side, so it proves the ingredients policy, not this table's.
      const seenByB = await withTenant(probe, tenantB.tenantId, async (tx) => {
        await asAppUser(tx);
        return countRecipeLines(tx);
      });
      expect(seenByB).toBe(0);
    } finally {
      await probe.close();
    }
  });

  it("allows DELETE on recipe_lines under app_user (grant includes DELETE)", async () => {
    // The mirror of the ingredients DELETE test: `recipe_lines` DOES hold a DELETE grant (0039), so
    // an app_user DELETE of its own tenant's rows succeeds rather than raising 42501. Self-contained
    // and order-independent — it re-establishes the line before deleting and restores it after — so
    // the isolation test above sees the seeded line regardless of run order (CLAUDE.md §4).
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenantA.tenantId, async (tx) => {
        await asAppUser(tx);
        await setProductRecipe(tx, productId, [ingredientId]);
        expect((await getProductRecipe(tx, productId)).length).toBe(1);

        // The assertion: this DELETE must NOT throw (contrast ingredients, which has no DELETE grant).
        await tx.execute(sql`delete from recipe_lines where tenant_id = ${tenantA.tenantId}`);
        expect(await getProductRecipe(tx, productId)).toEqual([]);

        // Restore the line so this test leaves the seeded state intact for the isolation test.
        await setProductRecipe(tx, productId, [ingredientId]);
      });
    } finally {
      await probe.close();
    }
  });
});
