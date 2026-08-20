import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { asAppUser, captureError, pgErrorCode, pgErrorMessage, withTenant } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { createIngredient, listIngredients } from "./ingredients.js";
import { seedVenue } from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";

// A non-superuser LOGIN role that inherits app_user's grants, so it is a genuine RLS subject: the
// container's default user is a superuser and bypasses FORCE ROW LEVEL SECURITY, so a policy/grant
// assertion has to run under a role like this. The app_user membership is what grants it
// SELECT/INSERT/UPDATE on `ingredients` (0039_recipes_rls.sql); NO DELETE is granted, which the
// second test proves (SQLSTATE 42501). current_tenant_id() reads `app.tenant_id`, so a query under
// tenant B's GUC matches none of tenant A's rows. This suite runs on REAL Postgres: PGlite connects
// as a superuser and so bypasses FORCE ROW LEVEL SECURITY, which would make an RLS/grant assertion a
// false pass — CLAUDE.md §4 requires real Postgres for anything about privileges or RLS as the
// deployment role. Mirrors packages/catalogue/src/operations.rls.test.ts. This role is created once,
// cluster-wide, in the package's globalSetup (`src/testing/global-setup.ts`) — recipe-lines.rls.test.ts
// connects as the SAME `rls_probe`; see that file's header.
const PROBE_ROLE = "rls_probe";
const PROBE_PASSWORD = "probe";

const suite = useTemplateDb({ template: "core" });

describe("ingredients under real row-level security", () => {
  let tenantA: SeededVenue;
  let tenantB: SeededVenue;

  beforeAll(async () => {
    // Seed both tenants as the superuser (admin) — RLS is bypassed for seeding, which is fine: the
    // tenants themselves aren't the thing under test. The ingredient below is written as the
    // RLS-subject probe role, scoped to tenant A, so the INSERT exercises the grant and the WITH
    // CHECK half of the isolation policy.
    tenantA = await seedVenue(suite.admin);
    tenantB = await seedVenue(suite.admin);
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      await withTenant(probe, tenantA.tenantId, async (tx) => {
        await asAppUser(tx);
        await createIngredient(tx, {
          name: "alioli",
          allergens: { eggs: { presence: "contains" } },
        });
      });
    } finally {
      await probe.close();
    }
  });

  it("isolates one tenant's ingredients from another", async () => {
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      // Positive control — tenant A, the owner, sees its own row. Proves the SELECT grant and the
      // USING half of the policy, and that the seed landed. This is the read that the
      // prove-by-deletion RED/GREEN flips (weaken ingredients_tenant_isolation's USING to `true`).
      const own = await withTenant(probe, tenantA.tenantId, async (tx) => {
        await asAppUser(tx);
        return listIngredients(tx);
      });
      expect(own.map((i) => i.name)).toEqual(["alioli"]);

      // The isolation guarantee: the SAME probe role, holding the SAME SELECT grant, sees NONE of
      // tenant A's rows when scoped to tenant B. The only thing standing between this query and A's
      // rows is the isolation policy's USING clause (tenant_id = current_tenant_id()) evaluated
      // against B's GUC. `listIngredients` reads only `ingredients`, so weakening that one policy's
      // USING to `true` leaks A's ingredient here and this assertion fails.
      const seenByB = await withTenant(probe, tenantB.tenantId, async (tx) => {
        await asAppUser(tx);
        return listIngredients(tx);
      });
      expect(seenByB).toEqual([]);
    } finally {
      await probe.close();
    }
  });

  it("denies DELETE to app_user (grant is SELECT/INSERT/UPDATE only)", async () => {
    // **Deviation from the brief's earliest sketch, matching operations.rls.test.ts.** A bare
    // `.rejects.toThrow(/permission denied/i)` inspects only `Error.message`, and drizzle-orm@0.45.2
    // wraps every failed query in a `DrizzleQueryError` whose own `.message` is `Failed query: <sql>`
    // — the real Postgres text (`permission denied for table ingredients`, SQLSTATE 42501) lives on
    // `.cause`. `captureError`/`pgErrorMessage`/`pgErrorCode` read that instead, the same convention
    // packages/core/src/incidents.test.ts documents for the identical wrapped permission-denied
    // assertion. `ingredients` deliberately has no DELETE grant (deactivate via `active`), unlike
    // `recipe_lines` (0039_recipes_rls.sql).
    const probe = await suite.pg.connectAs(PROBE_ROLE, PROBE_PASSWORD);
    try {
      const error = await captureError(() =>
        withTenant(probe, tenantA.tenantId, async (tx) => {
          await asAppUser(tx);
          await tx.execute(sql`delete from ingredients where tenant_id = ${tenantA.tenantId}`);
        }),
      );
      expect(pgErrorMessage(error)).toMatch(/permission denied for table ingredients/);
      expect(pgErrorCode(error)).toBe("42501");
    } finally {
      await probe.close();
    }
  });
});
