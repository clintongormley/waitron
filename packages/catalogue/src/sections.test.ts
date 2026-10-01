import { createIncludedMenu as createSection } from "../test/included-menu.js";
import type { SectionInput } from "./section-types.js";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { withTransaction, type Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { seedLegacySellingUnits, useCatalogueDb } from "../test/fixtures.js";
import { createCatalogue, createCategory, createProduct } from "./operations.js";
import { setProductVariants } from "./variants.js";
import { writeContentLanguages } from "./content-languages.js";
import * as sectionStructure from "./section-structure.js";
import {
  addMember,
  addProducts,
  createSectionIn,
  deleteSection,
  listMembers,
  moveMember,
  readSection,
  removeMember,
  replaceMember,
  updateSection,
} from "./sections.js";
import type { MemberRef, SectionMember } from "./section-types.js";

// Section authoring and member writes. The cases with two transactions started together, and the
// constraint experiments on the tables themselves, are in sections.db.test.ts.
const fx = useCatalogueDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

const product = (productId: string): MemberRef => ({ kind: "product", productId });
const section = (sectionId: string): MemberRef => ({ kind: "section", sectionId });
const refs = (members: SectionMember[]) => members.map((member) => member.ref);
const positions = (members: SectionMember[]) => members.map((member) => member.position);

interface Fixture {
  lunchMenu: string;
  dinnerMenu: string;
  category: string;
  lemonade: string;
  water: string;
  lager: string;
  bread: string;
  /** A variant of lager: a `products` row with a parent. */
  pint: string;
}

async function fixture(): Promise<Fixture> {
  await seedTenant(fx.db);
  await seedLegacySellingUnits(fx.db);
  return app(async (tx) => {
    const lunch = await createCatalogue(tx, { name: "Lunch menu" });
    const dinner = await createCatalogue(tx, { name: "Dinner menu" });
    const category = await createCategory(tx, { name: "Beverages" });
    // Three different names per product, so a read of the wrong one cannot pass by accident.
    const make = async (name: string) =>
      (
        await createProduct(tx, {
          catalogueId: lunch.id,
          categoryId: category.id,
          name: `${name} (staff)`,
          customerName: { en: `${name} (customer)` },
          kitchenName: `${name} (kitchen)`,
          pricingUnit: "each",
          unitPrice: "2",
          vatClass: "general",
        })
      ).id;
    const lager = await make("Lager");
    const [pint] = await setProductVariants(
      tx,
      lager,
      [
        {
          name: "Pint",
          customerName: null,
          kitchenName: null,
          image: null,
          unitPrice: null,
          available: true,
        },
      ],
      "en",
    );
    return {
      lunchMenu: lunch.id,
      dinnerMenu: dinner.id,
      category: category.id,
      lemonade: await make("Lemonade"),
      water: await make("Water"),
      lager,
      bread: await make("Bread"),
      pint: pint!.id,
    };
  });
}

/** The root or default home layout `createCatalogue` gave the menu. */
async function menuOwned(role: "menu_root" | "home_layout", menuId: string): Promise<string> {
  const { rows } = await fx.db.execute<{ id: string }>(sql`
    select ${sql.raw(role === "menu_root" ? "root_section_id" : "default_home_layout_id")} as id
      from menu_details where menu_id = ${menuId}`);
  return rows[0]!.id;
}

/** A member written directly, for a list the generic writes refuse. */
async function rawMember(sectionId: string, ref: MemberRef, position: number): Promise<string> {
  const id = crypto.randomUUID();
  await fx.db.execute(sql`
    insert into section_members (id, section_id, position, product_id, child_section_id)
    values (${id}, ${sectionId}, ${position},
      ${ref.kind === "product" ? ref.productId : null},
      ${ref.kind === "section" ? ref.sectionId : null})`);
  return id;
}

/** `count` copies of a product, written in one statement; the ids sort in the order returned. */
async function cloneProducts(templateId: string, count: number): Promise<string[]> {
  const { rows } = await fx.db.execute<{ name: string }>(sql`pragma table_info(products)`);
  const columns = rows.map((row) => row.name);
  const picked = columns.map((column) =>
    column === "id" ? sql`'bulk-' || substr('000000' || n, -6)` : sql.identifier(column),
  );
  await fx.db.execute(sql`
    insert into products (${sql.join(
      columns.map((column) => sql.identifier(column)),
      sql`, `,
    )})
    with recursive seq(n) as (select 1 union all select n + 1 from seq where n < ${count})
    select ${sql.join(picked, sql`, `)} from seq, products where products.id = ${templateId}`);
  return Array.from({ length: count }, (_, index) => `bulk-${String(index + 1).padStart(6, "0")}`);
}

async function createOwned(tx: Transaction, input: SectionInput) {
  const { rows } = await tx.execute<{ id: string }>(
    sql`select root_section_id as id from menu_details join catalogues on catalogues.id = menu_details.menu_id where catalogues.name = 'Lunch menu' limit 1`,
  );
  return createSectionIn(tx, rows[0]!.id, input);
}
const owned = (internalName: string) => app((tx) => createOwned(tx, { internalName }));
const create = (internalName: string) => app((tx) => createSection(tx, { internalName }));

let hook: MockInstance<typeof sectionStructure.onStructureChanged>;
beforeEach(() => {
  hook = vi.spyOn(sectionStructure, "onStructureChanged");
});
afterEach(() => {
  hook.mockRestore();
});

describe("section details", () => {
  it("creates, reads and updates an owned section", async () => {
    await fixture();
    const drinks = await app((tx) =>
      createOwned(tx, {
        internalName: "  Drinks  ",
        names: { en: "Something to drink", es: "Bebidas" },
        color: "#aabbcc",
      }),
    );
    expect(drinks).toEqual({
      id: drinks.id,
      internalName: "Drinks",
      names: { en: "Something to drink", es: "Bebidas" },
      image: null,
      color: "#aabbcc",
      members: [],
    });
    // Customer names are optional.
    const specials = await owned("Specials");
    expect(specials.names).toEqual({});
    expect(await app((tx) => readSection(tx, drinks.id))).toEqual(drinks);

    const updated = await app((tx) =>
      updateSection(tx, drinks.id, { internalName: "Cold drinks", names: {}, color: null }),
    );
    expect(updated).toEqual({ ...drinks, internalName: "Cold drinks", names: {}, color: null });
    // An absent key leaves its value alone.
    expect(await app((tx) => updateSection(tx, drinks.id, { color: "#000000" }))).toEqual({
      ...updated,
      color: "#000000",
    });
    expect(await app((tx) => updateSection(tx, drinks.id, {}))).toEqual({
      ...updated,
      color: "#000000",
    });
  });

  it("refuses an empty internal name", async () => {
    await fixture();
    const drinks = await owned("Drinks");
    for (const internalName of ["", "   ", 7 as unknown as string]) {
      await expect(app((tx) => createOwned(tx, { internalName }))).rejects.toMatchObject({
        code: "menu_section.invalid",
        params: { field: "internalName" },
      });
      await expect(
        app((tx) => updateSection(tx, drinks.id, { internalName })),
      ).rejects.toMatchObject({
        code: "menu_section.invalid",
        params: { field: "internalName" },
      });
    }
    expect((await app((tx) => readSection(tx, drinks.id))).internalName).toBe("Drinks");
  });

  it("refuses malformed customer names, colour and image", async () => {
    await fixture();
    const drinks = await owned("Drinks");
    const refused: [Parameters<typeof updateSection>[2], object][] = [
      [{ names: "Bebidas" as unknown as Record<string, string> }, { field: "names" }],
      [{ names: ["Bebidas"] as unknown as Record<string, string> }, { field: "names" }],
      [{ names: null as unknown as Record<string, string> }, { field: "names" }],
      [{ color: "#ABCDEF" }, { field: "color" }],
      [{ color: "red" }, { field: "color" }],
      [{ image: 7 as unknown as string }, { field: "image" }],
      // No media module is migrated here, so no image can exist.
      [{ image: `${"a".repeat(64)}.jpg` }, { field: "image" }],
    ];
    for (const [patch, params] of refused) {
      await expect(app((tx) => updateSection(tx, drinks.id, patch))).rejects.toMatchObject({
        code: "menu_section.invalid",
        params,
      });
      await expect(
        app((tx) => createOwned(tx, { internalName: "New", ...patch })),
      ).rejects.toMatchObject({ code: "menu_section.invalid", params });
    }
    await expect(
      app((tx) => updateSection(tx, drinks.id, { names: { en: 7 as unknown as string } })),
    ).rejects.toMatchObject({ code: "content.translation_invalid" });
    await expect(
      app((tx) => updateSection(tx, drinks.id, { names: { "not a language": "x" } })),
    ).rejects.toMatchObject({ code: "content.language_invalid" });
    expect(await app((tx) => readSection(tx, drinks.id))).toEqual(drinks);
  });

  it("refuses customer names with no text in the default content language, but accepts none", async () => {
    await fixture();
    await app((tx) =>
      writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "es"] }),
    );
    const drinks = await owned("Drinks");
    const refusal = {
      code: "menu_section.translation_required",
      params: { field: "names", language: "en" },
    };
    await expect(
      app((tx) => createOwned(tx, { internalName: "Bebidas", names: { es: "Bebidas" } })),
    ).rejects.toMatchObject(refusal);
    await expect(
      app((tx) => updateSection(tx, drinks.id, { names: { es: "Bebidas" } })),
    ).rejects.toMatchObject(refusal);
    expect(
      (await app((tx) => updateSection(tx, drinks.id, { names: { en: "Drinks", es: "Bebidas" } })))
        .names,
    ).toEqual({ en: "Drinks", es: "Bebidas" });
    expect((await app((tx) => updateSection(tx, drinks.id, { names: {} }))).names).toEqual({});
  });

  it("refuses to read, change or delete a section that does not exist", async () => {
    await fixture();
    const missing = crypto.randomUUID();
    const writes: ((tx: Transaction) => Promise<unknown>)[] = [
      (tx) => readSection(tx, missing),
      (tx) => listMembers(tx, missing),
      (tx) => updateSection(tx, missing, { internalName: "X" }),
      (tx) => deleteSection(tx, missing),
    ];
    for (const write of writes)
      await expect(app(write)).rejects.toMatchObject({
        code: "menu_section.not_found",
        params: { sectionId: missing },
      });
  });

  it("refuses to update or delete a menu root or home layout", async () => {
    const f = await fixture();
    for (const role of ["menu_root", "home_layout"] as const) {
      const owned = await menuOwned(role, f.lunchMenu);
      const writes: ((tx: Transaction) => Promise<unknown>)[] = [
        (tx) => updateSection(tx, owned, { internalName: "X" }),
        (tx) => deleteSection(tx, owned),
      ];
      for (const write of writes)
        await expect(app(write)).rejects.toMatchObject({
          code: "menu_section.wrong_role",
          params: { sectionId: owned },
        });
    }
  });
});

describe("membership and order", () => {
  it("appends each member and refuses the same product or section twice in one list", async () => {
    const f = await fixture();
    const drinks = await create("Drinks");
    const beer = await create("Beer");
    await app((tx) => addMember(tx, drinks.id, product(f.lemonade)));
    const added = await app((tx) => addMember(tx, drinks.id, section(beer.id)));
    expect(added).toEqual({ id: added.id, position: 1, ref: section(beer.id) });
    await expect(app((tx) => addMember(tx, drinks.id, product(f.lemonade)))).rejects.toMatchObject({
      code: "menu_section.member_duplicate",
      params: { sectionId: drinks.id },
    });
    await expect(app((tx) => addMember(tx, drinks.id, section(beer.id)))).rejects.toMatchObject({
      code: "menu_section.member_duplicate",
      params: { sectionId: drinks.id },
    });
    const members = (await app((tx) => readSection(tx, drinks.id))).members;
    expect(refs(members)).toEqual([product(f.lemonade), section(beer.id)]);
    expect(positions(members)).toEqual([0, 1]);
  });

  it("puts a member at the position asked for and renumbers the list", async () => {
    const f = await fixture();
    const drinks = await create("Drinks");
    await app((tx) => addMember(tx, drinks.id, product(f.lemonade)));
    await app((tx) => addMember(tx, drinks.id, product(f.water)));
    await app((tx) => addMember(tx, drinks.id, product(f.lager), 0));
    await app((tx) => addMember(tx, drinks.id, product(f.bread), 2));
    const members = (await app((tx) => readSection(tx, drinks.id))).members;
    expect(refs(members)).toEqual([
      product(f.lager),
      product(f.lemonade),
      product(f.bread),
      product(f.water),
    ]);
    expect(positions(members)).toEqual([0, 1, 2, 3]);
    // A position past the end appends.
    const specials = await create("Specials");
    await app((tx) => addMember(tx, specials.id, product(f.water), 9));
    expect(positions((await app((tx) => readSection(tx, specials.id))).members)).toEqual([0]);
    for (const position of [-1, 1.5, "0" as unknown as number])
      await expect(
        app((tx) => addMember(tx, drinks.id, product(f.water), position)),
      ).rejects.toMatchObject({ code: "menu_section.invalid", params: { field: "position" } });
  });

  it("refuses a member that is no product, a variant, or a section that does not exist", async () => {
    const f = await fixture();
    const drinks = await create("Drinks");
    const missing = crypto.randomUUID();
    for (const ref of [product(missing), product(f.pint)])
      await expect(app((tx) => addMember(tx, drinks.id, ref))).rejects.toMatchObject({
        code: "menu_section.membership_invalid",
      });
    await expect(app((tx) => addMember(tx, drinks.id, section(missing)))).rejects.toMatchObject({
      code: "menu_section.not_found",
      params: { sectionId: missing },
    });
    await expect(app((tx) => addMember(tx, missing, product(f.water)))).rejects.toMatchObject({
      code: "menu_section.not_found",
      params: { sectionId: missing },
    });
    expect((await app((tx) => readSection(tx, drinks.id))).members).toEqual([]);
  });

  it("adds several products at once, skipping those already in the list", async () => {
    const f = await fixture();
    const drinks = await create("Drinks");
    await app((tx) => addMember(tx, drinks.id, product(f.water)));
    expect(await app((tx) => addProducts(tx, drinks.id, [f.lemonade, f.water, f.lager]))).toEqual({
      added: 2,
    });
    expect(refs((await app((tx) => readSection(tx, drinks.id))).members)).toEqual([
      product(f.water),
      product(f.lemonade),
      product(f.lager),
    ]);
    expect(await app((tx) => addProducts(tx, drinks.id, []))).toEqual({ added: 0 });
  });

  it("adds more products than one statement can bind, every one in the order given", async () => {
    const f = await fixture();
    const drinks = await create("Drinks");
    await app((tx) => addMember(tx, drinks.id, product(f.water)));
    // The committed one-insert-per-row loop took this many; one statement binding them all did not.
    const ids = await cloneProducts(f.lemonade, 20_000);

    expect(await app((tx) => addProducts(tx, drinks.id, ids))).toEqual({ added: ids.length });

    const { members } = await app((tx) => readSection(tx, drinks.id));
    expect(refs(members)).toEqual([product(f.water), ...ids.map(product)]);
    expect(positions(members)).toEqual(members.map((_, index) => index));
  });

  it("refuses a product named twice, or a variant, however far apart in the list", async () => {
    const f = await fixture();
    const drinks = await create("Drinks");
    const ids = await cloneProducts(f.lemonade, 1_500);
    for (const late of [ids[0]!, f.pint])
      await expect(app((tx) => addProducts(tx, drinks.id, [...ids, late]))).rejects.toMatchObject({
        code: "menu_section.membership_invalid",
      });
    expect((await app((tx) => readSection(tx, drinks.id))).members).toEqual([]);
  });

  it("refuses a whole batch naming an unknown product, a variant or one product twice", async () => {
    const f = await fixture();
    const drinks = await create("Drinks");
    for (const ids of [
      [f.lemonade, crypto.randomUUID()],
      [f.lemonade, f.pint],
      [f.lemonade, f.lemonade],
      "nope" as unknown as string[],
    ])
      await expect(app((tx) => addProducts(tx, drinks.id, ids))).rejects.toMatchObject({
        code: "menu_section.membership_invalid",
      });
    expect((await app((tx) => readSection(tx, drinks.id))).members).toEqual([]);
  });

  it("moves a member, and a list sharing the same section keeps its own order", async () => {
    const f = await fixture();
    const drinks = await create("Drinks");
    const favourites = await create("Favourites");
    const beer = await create("Beer");
    for (const list of [drinks.id, favourites.id]) {
      await app((tx) => addMember(tx, list, product(f.lemonade)));
      await app((tx) => addMember(tx, list, product(f.water)));
      await app((tx) => addMember(tx, list, section(beer.id)));
    }
    const beerInDrinks = (await app((tx) => readSection(tx, drinks.id))).members[2]!;
    const moved = await app((tx) => moveMember(tx, drinks.id, beerInDrinks.id, 0));
    expect(refs(moved)).toEqual([section(beer.id), product(f.lemonade), product(f.water)]);
    expect(positions(moved)).toEqual([0, 1, 2]);
    expect((await app((tx) => readSection(tx, drinks.id))).members).toEqual(moved);
    expect(refs((await app((tx) => readSection(tx, favourites.id))).members)).toEqual([
      product(f.lemonade),
      product(f.water),
      section(beer.id),
    ]);
    // Past the end moves it last.
    expect(refs(await app((tx) => moveMember(tx, drinks.id, beerInDrinks.id, 99)))).toEqual([
      product(f.lemonade),
      product(f.water),
      section(beer.id),
    ]);
    for (const to of [-1, 0.5, null as unknown as number])
      await expect(
        app((tx) => moveMember(tx, drinks.id, beerInDrinks.id, to)),
      ).rejects.toMatchObject({ code: "menu_section.invalid", params: { field: "to" } });
  });

  it("lists a list's members in order, a menu's own list included", async () => {
    const f = await fixture();
    const root = await menuOwned("menu_root", f.lunchMenu);
    const drinks = await create("Drinks");
    await app((tx) => addProducts(tx, root, [f.water, f.lemonade]));
    await app((tx) => addMember(tx, root, section(drinks.id), 1));
    const members = await app((tx) => listMembers(tx, root));
    expect(refs(members)).toEqual([product(f.water), section(drinks.id), product(f.lemonade)]);
    expect(members).toEqual((await app((tx) => readSection(tx, root))).members);
    expect(await app((tx) => listMembers(tx, drinks.id))).toEqual([]);
  });

  it("removes a member and renumbers what is left", async () => {
    const f = await fixture();
    const drinks = await create("Drinks");
    await app((tx) => addProducts(tx, drinks.id, [f.lemonade, f.water, f.lager]));
    const [, water] = (await app((tx) => readSection(tx, drinks.id))).members;
    await app((tx) => removeMember(tx, drinks.id, water!.id));
    const members = (await app((tx) => readSection(tx, drinks.id))).members;
    expect(refs(members)).toEqual([product(f.lemonade), product(f.lager)]);
    expect(positions(members)).toEqual([0, 1]);
  });

  it("refuses a member id the list does not hold", async () => {
    const f = await fixture();
    const drinks = await create("Drinks");
    const other = await create("Other");
    const held = await app((tx) => addMember(tx, other.id, product(f.water)));
    for (const memberId of [crypto.randomUUID(), held.id]) {
      const writes: ((tx: Transaction) => Promise<unknown>)[] = [
        (tx) => removeMember(tx, drinks.id, memberId),
        (tx) => moveMember(tx, drinks.id, memberId, 0),
        (tx) => replaceMember(tx, drinks.id, memberId, product(f.lager)),
      ];
      for (const write of writes)
        await expect(app(write)).rejects.toMatchObject({
          code: "menu_section.not_found",
          params: { sectionId: drinks.id, memberId },
        });
    }
    expect((await app((tx) => readSection(tx, other.id))).members).toEqual([held]);
  });

  it("gives a nested section's products no direct membership of the list holding it", async () => {
    const f = await fixture();
    const drinks = await create("Drinks");
    const beer = await create("Beer");
    await app((tx) => addMember(tx, beer.id, product(f.lager)));
    await app((tx) => addMember(tx, drinks.id, section(beer.id)));
    expect(refs((await app((tx) => readSection(tx, drinks.id))).members)).toEqual([
      section(beer.id),
    ]);
    // Lager reached through Beer is not already a member of Drinks, so adding it is no duplicate.
    await app((tx) => addMember(tx, drinks.id, product(f.lager)));
    expect(refs((await app((tx) => readSection(tx, drinks.id))).members)).toEqual([
      section(beer.id),
      product(f.lager),
    ]);
  });
});

describe("cycles", () => {
  it("refuses a section containing itself, directly or through others", async () => {
    await fixture();
    const a = await create("A");
    const b = await create("B");
    const c = await create("C");
    await app((tx) => addMember(tx, a.id, section(b.id)));
    await app((tx) => addMember(tx, b.id, section(c.id)));
    for (const [parent, child] of [
      [a.id, a.id],
      [b.id, a.id],
      [c.id, a.id],
    ] as const)
      await expect(app((tx) => addMember(tx, parent, section(child)))).rejects.toMatchObject({
        code: "menu_section.member_cycle",
        params: { sectionId: parent, childSectionId: child },
      });
    expect(refs((await app((tx) => readSection(tx, c.id))).members)).toEqual([]);
  });
});

describe("roles", () => {
  it("refuses an owned section or home layout as an inclusion", async () => {
    const f = await fixture();
    const target = await create("Target");
    const own = await owned("Own");
    const layout = await menuOwned("home_layout", f.lunchMenu);
    for (const id of [own.id, layout])
      await expect(app((tx) => addMember(tx, target.id, section(id)))).rejects.toMatchObject({
        code: "menu_section.wrong_role",
      });
  });

  it("accepts members into a menu's root list", async () => {
    const f = await fixture();
    const root = await menuOwned("menu_root", f.lunchMenu);
    const drinks = await create("Drinks");
    await app((tx) => addMember(tx, root, section(drinks.id)));
    await app((tx) => addMember(tx, root, product(f.bread)));
    expect(refs((await app((tx) => readSection(tx, root))).members)).toEqual([
      section(drinks.id),
      product(f.bread),
    ]);
  });

  it("refuses every generic member write into a home layout", async () => {
    const f = await fixture();
    const layout = await menuOwned("home_layout", f.lunchMenu);
    const drinks = await create("Drinks");
    const tile = await rawMember(layout, section(drinks.id), 0);
    const writes: ((tx: Transaction) => Promise<unknown>)[] = [
      (tx) => addMember(tx, layout, product(f.water)),
      (tx) => addProducts(tx, layout, [f.water]),
      (tx) => removeMember(tx, layout, tile),
      (tx) => moveMember(tx, layout, tile, 0),
      (tx) => replaceMember(tx, layout, tile, product(f.water)),
    ];
    for (const write of writes)
      await expect(app(write)).rejects.toMatchObject({
        code: "menu_section.wrong_role",
        params: { sectionId: layout },
      });
    expect(refs((await app((tx) => readSection(tx, layout))).members)).toEqual([
      section(drinks.id),
    ]);
  });
});

describe("replace", () => {
  it("puts the new member at the old one's position", async () => {
    const f = await fixture();
    const drinks = await create("Drinks");
    const beer = await create("Beer");
    await app((tx) => addProducts(tx, drinks.id, [f.lemonade, f.water, f.bread]));
    const [, water] = (await app((tx) => readSection(tx, drinks.id))).members;
    const replaced = await app((tx) => replaceMember(tx, drinks.id, water!.id, section(beer.id)));
    expect(replaced).toEqual({ id: water!.id, position: 1, ref: section(beer.id) });
    expect(refs((await app((tx) => readSection(tx, drinks.id))).members)).toEqual([
      product(f.lemonade),
      section(beer.id),
      product(f.bread),
    ]);
    // Back to a product: the section reference is cleared with it.
    await app((tx) => replaceMember(tx, drinks.id, water!.id, product(f.lager)));
    expect(refs((await app((tx) => readSection(tx, drinks.id))).members)).toEqual([
      product(f.lemonade),
      product(f.lager),
      product(f.bread),
    ]);
    // Replacing a member with what it already holds changes nothing.
    await app((tx) => replaceMember(tx, drinks.id, water!.id, product(f.lager)));
    expect(refs((await app((tx) => readSection(tx, drinks.id))).members)).toEqual([
      product(f.lemonade),
      product(f.lager),
      product(f.bread),
    ]);
  });

  it("refuses a cycle, a duplicate and an unusable member with the codes addMember uses", async () => {
    const f = await fixture();
    const drinks = await create("Drinks");
    const beer = await create("Beer");
    await app((tx) => addMember(tx, drinks.id, section(beer.id)));
    const lager = await app((tx) => addMember(tx, beer.id, product(f.lager)));
    await app((tx) => addMember(tx, beer.id, product(f.water)));
    const cases: [MemberRef, object][] = [
      [section(drinks.id), { code: "menu_section.member_cycle" }],
      [section(beer.id), { code: "menu_section.member_cycle" }],
      [product(f.water), { code: "menu_section.member_duplicate" }],
      [product(f.pint), { code: "menu_section.membership_invalid" }],
    ];
    for (const [ref, error] of cases)
      await expect(app((tx) => replaceMember(tx, beer.id, lager.id, ref))).rejects.toMatchObject(
        error,
      );
    expect(refs((await app((tx) => readSection(tx, beer.id))).members)).toEqual([
      product(f.lager),
      product(f.water),
    ]);
  });

  it("tells the structure hook once, with the menus of the final structure", async () => {
    const f = await fixture();
    const lunchRoot = await menuOwned("menu_root", f.lunchMenu);
    const dinnerRoot = await menuOwned("menu_root", f.dinnerMenu);
    const drinks = await create("Drinks");
    const summer = await create("Summer drinks");
    await app((tx) => addMember(tx, drinks.id, product(f.lemonade)));
    await app((tx) => addMember(tx, summer.id, product(f.water)));
    const inLunch = await app((tx) => addMember(tx, lunchRoot, section(drinks.id)));
    await app((tx) => addMember(tx, dinnerRoot, section(drinks.id)));
    hook.mockClear();
    await app((tx) => replaceMember(tx, lunchRoot, inLunch.id, section(summer.id)));
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook.mock.calls[0]![1]).toEqual([f.lunchMenu]);
  });
});

describe("the structure hook", () => {
  it("is told once per member write, including the owner and every including menu", async () => {
    const f = await fixture();
    const lunchRoot = await menuOwned("menu_root", f.lunchMenu);
    const drinks = await create("Drinks");
    await app((tx) => addMember(tx, lunchRoot, section(drinks.id)));
    const expectOneCall = () => {
      expect(hook).toHaveBeenCalledTimes(1);
      expect(hook.mock.calls[0]![1]).toEqual([f.lunchMenu, drinks.ownerMenuId].sort());
      hook.mockClear();
    };
    hook.mockClear();
    const water = await app((tx) => addMember(tx, drinks.id, product(f.water)));
    expectOneCall();
    await app((tx) => addProducts(tx, drinks.id, [f.lemonade]));
    expectOneCall();
    await app((tx) => moveMember(tx, drinks.id, water.id, 1));
    expectOneCall();
    await app((tx) => removeMember(tx, drinks.id, water.id));
    expectOneCall();
  });
  it("works out an owned section delete's menus before the cascade removes the link", async () => {
    const f = await fixture();
    const drinks = await owned("Drinks");
    hook.mockClear();
    await app((tx) => deleteSection(tx, drinks.id));
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook.mock.calls[0]![1]).toEqual([f.lunchMenu]);
  });
});
