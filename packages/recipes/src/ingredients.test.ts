import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import type { TenantId } from "@waitron/shared";
import {
  createIngredient,
  getIngredient,
  listIngredients,
  updateIngredient,
} from "./ingredients.js";
import { seedVenue } from "../test/fixtures.js";

const fx = usePgliteDb({ migrations: [CORE_MIGRATIONS] });

describe("ingredient operations", () => {
  let tenantId: TenantId;
  beforeEach(async () => {
    ({ tenantId } = await seedVenue(fx.db));
  });

  it("creates an ingredient with allergens and reads it back", async () => {
    const result = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const created = await createIngredient(tx, {
        name: "alioli",
        allergens: { eggs: { presence: "contains" } },
      });
      return {
        created,
        list: await listIngredients(tx),
        fetched: await getIngredient(tx, created.id),
      };
    });
    expect(result.created.name).toBe("alioli");
    expect(result.created.allergens).toEqual({ eggs: { presence: "contains" } });
    expect(result.list).toHaveLength(1);
    expect(result.fetched?.id).toBe(result.created.id);
  });

  it("creates an unreviewed (PENDING) ingredient when allergens are omitted", async () => {
    const created = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      return createIngredient(tx, { name: "mystery paste" });
    });
    expect(created.allergens).toBeNull();
  });

  it("rejects an invalid allergen code", async () => {
    await expect(
      withTenant(fx.db, tenantId, async (tx) => {
        await asAppUser(tx);
        return createIngredient(tx, {
          name: "x",
          allergens: { banana: { presence: "contains" } } as never,
        });
      }),
    ).rejects.toThrow();
  });

  it("updates name and allergens", async () => {
    const after = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const c = await createIngredient(tx, { name: "alioli" });
      await updateIngredient(tx, c.id, { allergens: { eggs: { presence: "contains" } } });
      return getIngredient(tx, c.id);
    });
    expect(after?.allergens).toEqual({ eggs: { presence: "contains" } });
  });

  it("updates name and deactivates without touching allergens", async () => {
    const after = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const c = await createIngredient(tx, {
        name: "alioli",
        allergens: { eggs: { presence: "contains" } },
      });
      await updateIngredient(tx, c.id, { name: "salsa", active: false });
      return getIngredient(tx, c.id);
    });
    expect(after?.name).toBe("salsa");
    expect(after?.active).toBe(false);
    // allergens omitted from the patch — left unchanged.
    expect(after?.allergens).toEqual({ eggs: { presence: "contains" } });
  });

  it("creates an ingredient with a dietary origin and reads it back", async () => {
    const result = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const created = await createIngredient(tx, { name: "beef", dietaryOrigin: "meat" });
      return { created, fetched: await getIngredient(tx, created.id) };
    });
    expect(result.created.dietaryOrigin).toBe("meat");
    expect(result.fetched?.dietaryOrigin).toBe("meat");
  });

  it("creates an uncategorised ingredient (dietaryOrigin null) when omitted", async () => {
    const created = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      return createIngredient(tx, { name: "mystery" });
    });
    expect(created.dietaryOrigin).toBeNull();
  });

  it("rejects an invalid dietary origin on create", async () => {
    await expect(
      withTenant(fx.db, tenantId, async (tx) => {
        await asAppUser(tx);
        return createIngredient(tx, { name: "x", dietaryOrigin: "wombat" as never });
      }),
    ).rejects.toThrow(/diet.invalid_origin/);
  });

  it("updates the dietary origin", async () => {
    const after = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const c = await createIngredient(tx, { name: "tofu", dietaryOrigin: "plant" });
      await updateIngredient(tx, c.id, { dietaryOrigin: "meat" });
      return getIngredient(tx, c.id);
    });
    expect(after?.dietaryOrigin).toBe("meat");
  });

  it("clears the dietary origin (uncategorise) with null", async () => {
    const after = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      const c = await createIngredient(tx, { name: "tofu", dietaryOrigin: "plant" });
      await updateIngredient(tx, c.id, { dietaryOrigin: null });
      return getIngredient(tx, c.id);
    });
    expect(after?.dietaryOrigin).toBeNull();
  });

  it("rejects an invalid dietary origin on update", async () => {
    await expect(
      withTenant(fx.db, tenantId, async (tx) => {
        await asAppUser(tx);
        const c = await createIngredient(tx, { name: "x" });
        return updateIngredient(tx, c.id, { dietaryOrigin: "wombat" as never });
      }),
    ).rejects.toThrow(/diet.invalid_origin/);
  });

  it("returns null from getIngredient for an id that does not exist", async () => {
    const fetched = await withTenant(fx.db, tenantId, async (tx) => {
      await asAppUser(tx);
      return getIngredient(tx, "00000000-0000-0000-0000-000000000000");
    });
    expect(fetched).toBeNull();
  });
});
