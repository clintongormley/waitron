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
  createSection,
  deleteSection,
  duplicateSection,
  listMembers,
  librarySectionUsages,
  listSections,
  moveMember,
  readSection,
  removeMember,
  replaceMember,
  sectionUsages,
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
    const category = await createCategory(tx, { name: { en: "Beverages" } });
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

const create = (internalName: string) => app((tx) => createSection(tx, { internalName }));

let hook: MockInstance<typeof sectionStructure.onStructureChanged>;
beforeEach(() => {
  hook = vi.spyOn(sectionStructure, "onStructureChanged");
});
afterEach(() => {
  hook.mockRestore();
});

describe("section details", () => {
  it("creates, reads, lists and updates a library section", async () => {
    await fixture();
    const drinks = await app((tx) =>
      createSection(tx, {
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
    const specials = await create("Specials");
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

  it("lists library sections only, by internal name", async () => {
    const f = await fixture();
    const specials = await create("Specials");
    const beer = await create("Beer");
    await menuOwned("menu_root", f.lunchMenu);
    await menuOwned("home_layout", f.lunchMenu);
    await app((tx) => addMember(tx, beer.id, product(f.lager)));
    const listed = await app((tx) => listSections(tx));
    expect(listed.map((row) => row.internalName)).toEqual(["Beer", "Specials"]);
    expect(listed[0]!.members.map((member) => member.ref)).toEqual([product(f.lager)]);
    expect(listed[1]).toEqual(specials);
  });

  it("refuses an empty internal name", async () => {
    await fixture();
    const drinks = await create("Drinks");
    for (const internalName of ["", "   ", 7 as unknown as string]) {
      await expect(app((tx) => createSection(tx, { internalName }))).rejects.toMatchObject({
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
    const drinks = await create("Drinks");
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
        app((tx) => createSection(tx, { internalName: "New", ...patch })),
      ).rejects.toMatchObject({ code: "menu_section.invalid", params });
    }
    await expect(
      app((tx) => updateSection(tx, drinks.id, { names: { en: 7 as unknown as string } })),
    ).rejects.toMatchObject({ code: "content.translation_invalid" });
    await expect(
      app((tx) => updateSection(tx, drinks.id, { names: { "not a language": "x" } })),
    ).rejects.toMatchObject({ code: "content.language_invalid" });
    expect(await app((tx) => listSections(tx))).toEqual([drinks]);
  });

  it("refuses customer names with no text in the default content language, but accepts none", async () => {
    await fixture();
    await app((tx) =>
      writeContentLanguages(tx, { defaultLanguage: "en", languages: ["en", "es"] }),
    );
    const drinks = await create("Drinks");
    const refusal = {
      code: "menu_section.translation_required",
      params: { field: "names", language: "en" },
    };
    await expect(
      app((tx) => createSection(tx, { internalName: "Bebidas", names: { es: "Bebidas" } })),
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
      (tx) => sectionUsages(tx, missing),
      (tx) => duplicateSection(tx, missing, { internalName: "Copy", memberIds: [] }),
    ];
    for (const write of writes)
      await expect(app(write)).rejects.toMatchObject({
        code: "menu_section.not_found",
        params: { sectionId: missing },
      });
  });

  it("refuses to change, delete or duplicate a list a menu owns", async () => {
    const f = await fixture();
    for (const role of ["menu_root", "home_layout"] as const) {
      const owned = await menuOwned(role, f.lunchMenu);
      const writes: ((tx: Transaction) => Promise<unknown>)[] = [
        (tx) => updateSection(tx, owned, { internalName: "X" }),
        (tx) => deleteSection(tx, owned),
        (tx) => duplicateSection(tx, owned, { internalName: "Copy", memberIds: [] }),
      ];
      for (const write of writes)
        await expect(app(write)).rejects.toMatchObject({
          code: "menu_section.not_library",
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
  it("refuses a menu-owned list as a member of any list", async () => {
    const f = await fixture();
    const drinks = await create("Drinks");
    for (const role of ["menu_root", "home_layout"] as const) {
      const owned = await menuOwned(role, f.lunchMenu);
      await expect(app((tx) => addMember(tx, drinks.id, section(owned)))).rejects.toMatchObject({
        code: "menu_section.not_library",
        params: { sectionId: owned },
      });
    }
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
      (tx) =>
        duplicateSection(tx, drinks.id, {
          internalName: "Copy",
          memberIds: [],
          replaceIn: { sectionId: layout, memberId: tile },
        }),
    ];
    for (const write of writes)
      await expect(app(write)).rejects.toMatchObject({
        code: "menu_section.not_library",
        params: { sectionId: layout },
      });
    expect(refs((await app((tx) => readSection(tx, layout))).members)).toEqual([
      section(drinks.id),
    ]);
    expect((await app((tx) => listSections(tx))).map((row) => row.internalName)).toEqual([
      "Drinks",
    ]);
  });
});

describe("duplicate", () => {
  it("copies the details and the chosen members in order, sharing nested sections", async () => {
    const f = await fixture();
    const drinks = await app((tx) =>
      createSection(tx, {
        internalName: "Drinks",
        names: { en: "Something to drink", es: "Bebidas" },
        color: "#112233",
      }),
    );
    const beer = await create("Beer");
    await app((tx) => addMember(tx, beer.id, product(f.lager)));
    await app((tx) => addProducts(tx, drinks.id, [f.lemonade, f.water]));
    await app((tx) => addMember(tx, drinks.id, section(beer.id)));
    const [lemonade, , nested] = (await app((tx) => readSection(tx, drinks.id))).members;
    const countProducts = async () =>
      (await fx.db.execute<{ n: number }>(sql`select count(*) as n from products`)).rows[0]!.n;
    const before = await countProducts();

    const copy = await app((tx) =>
      duplicateSection(tx, drinks.id, {
        internalName: " Summer drinks ",
        // Chosen out of order: the copy keeps the source's order.
        memberIds: [nested!.id, lemonade!.id],
      }),
    );
    expect(copy).toMatchObject({
      internalName: "Summer drinks",
      names: { en: "Something to drink", es: "Bebidas" },
      image: null,
      color: "#112233",
    });
    expect(copy.id).not.toBe(drinks.id);
    expect(refs(copy.members)).toEqual([product(f.lemonade), section(beer.id)]);
    expect(positions(copy.members)).toEqual([0, 1]);
    expect(await countProducts()).toBe(before);
    // The source is untouched.
    expect(refs((await app((tx) => readSection(tx, drinks.id))).members)).toEqual([
      product(f.lemonade),
      product(f.water),
      section(beer.id),
    ]);
  });

  it("copies more members than one statement can bind, in the source's order", async () => {
    const f = await fixture();
    const drinks = await create("Drinks");
    const ids = await cloneProducts(f.lemonade, 20_000);
    await fx.db.execute(sql`
      insert into section_members (id, section_id, position, product_id)
      select 'member-' || id, ${drinks.id}, row_number() over (order by id) - 1, id
      from products where id like 'bulk-%'`);
    const source = await app((tx) => readSection(tx, drinks.id));

    const copy = await app((tx) =>
      duplicateSection(tx, drinks.id, {
        internalName: "Copy",
        memberIds: source.members.map((member) => member.id),
      }),
    );
    expect(refs(copy.members)).toEqual(ids.map(product));
    expect(positions(copy.members)).toEqual(ids.map((_, index) => index));
  });

  it("refuses a member id the source does not hold, a repeated one, or a blank name", async () => {
    const f = await fixture();
    const drinks = await create("Drinks");
    const other = await create("Other");
    const own = await app((tx) => addMember(tx, drinks.id, product(f.water)));
    const foreign = await app((tx) => addMember(tx, other.id, product(f.water)));
    for (const memberIds of [
      [foreign.id],
      [own.id, own.id],
      [crypto.randomUUID()],
      "x" as unknown as string[],
    ])
      await expect(
        app((tx) => duplicateSection(tx, drinks.id, { internalName: "Copy", memberIds })),
      ).rejects.toMatchObject({ code: "menu_section.membership_invalid" });
    await expect(
      app((tx) => duplicateSection(tx, drinks.id, { internalName: " ", memberIds: [own.id] })),
    ).rejects.toMatchObject({ code: "menu_section.invalid", params: { field: "internalName" } });
    expect((await app((tx) => listSections(tx))).map((row) => row.internalName)).toEqual([
      "Drinks",
      "Other",
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
    const root = await menuOwned("menu_root", f.lunchMenu);
    const cases: [MemberRef, object][] = [
      [section(drinks.id), { code: "menu_section.member_cycle" }],
      [section(beer.id), { code: "menu_section.member_cycle" }],
      [product(f.water), { code: "menu_section.member_duplicate" }],
      [product(f.pint), { code: "menu_section.membership_invalid" }],
      [section(root), { code: "menu_section.not_library" }],
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

  it("duplicates and replaces in the caller's one transaction, with one call to the hook", async () => {
    const f = await fixture();
    const lunchRoot = await menuOwned("menu_root", f.lunchMenu);
    const drinks = await create("Drinks");
    const lemonade = await app((tx) => addMember(tx, drinks.id, product(f.lemonade)));
    const inLunch = await app((tx) => addMember(tx, lunchRoot, section(drinks.id)));
    hook.mockClear();
    const copy = await app((tx) =>
      duplicateSection(tx, drinks.id, {
        internalName: "Lunch drinks",
        memberIds: [lemonade.id],
        replaceIn: { sectionId: lunchRoot, memberId: inLunch.id },
      }),
    );
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook.mock.calls[0]![1]).toEqual([f.lunchMenu]);
    expect(refs((await app((tx) => readSection(tx, lunchRoot))).members)).toEqual([
      section(copy.id),
    ]);
    expect(refs(copy.members)).toEqual([product(f.lemonade)]);
  });

  it("refuses an unusable replaceIn before it writes the copy", async () => {
    const f = await fixture();
    const layout = await menuOwned("home_layout", f.lunchMenu);
    const drinks = await create("Drinks");
    const tile = await rawMember(layout, section(drinks.id), 0);
    const unknown = crypto.randomUUID();
    await app(async (tx) => {
      // Caught inside the one transaction, so a copy written before the refusal would still show.
      for (const [replaceIn, error] of [
        [{ sectionId: layout, memberId: tile }, { code: "menu_section.not_library" }],
        [
          { sectionId: drinks.id, memberId: unknown },
          { code: "menu_section.not_found", params: { sectionId: drinks.id, memberId: unknown } },
        ],
      ] as const)
        await expect(
          duplicateSection(tx, drinks.id, { internalName: "Copy", memberIds: [], replaceIn }),
        ).rejects.toMatchObject(error);
      expect((await listSections(tx)).map((row) => row.internalName)).toEqual(["Drinks"]);
    });
    expect(hook).not.toHaveBeenCalled();
  });

  it("leaves neither the copy nor the replacement when the replace is refused", async () => {
    const f = await fixture();
    const drinks = await create("Drinks");
    const beer = await create("Beer");
    const nested = await app((tx) => addMember(tx, drinks.id, section(beer.id)));
    const inBeer = await app((tx) => addMember(tx, beer.id, product(f.lager)));
    // The copy holds Beer, so putting it inside Beer closes a loop.
    await expect(
      app((tx) =>
        duplicateSection(tx, drinks.id, {
          internalName: "Copy",
          memberIds: [nested.id],
          replaceIn: { sectionId: beer.id, memberId: inBeer.id },
        }),
      ),
    ).rejects.toMatchObject({
      code: "menu_section.member_cycle",
      params: { sectionId: beer.id, childSectionId: expect.any(String) },
    });
    expect((await app((tx) => listSections(tx))).map((row) => row.internalName)).toEqual([
      "Beer",
      "Drinks",
    ]);
    expect(refs((await app((tx) => readSection(tx, beer.id))).members)).toEqual([product(f.lager)]);
  });

  it("refuses a replaceIn list the copy's kept sections reach at any depth", async () => {
    const f = await fixture();
    const drinks = await create("Drinks");
    const beer = await create("Beer");
    const ales = await create("Ales");
    await app((tx) => addMember(tx, drinks.id, product(f.water)));
    const nested = await app((tx) => addMember(tx, drinks.id, section(beer.id)));
    await app((tx) => addMember(tx, beer.id, section(ales.id)));
    const inAles = await app((tx) => addMember(tx, ales.id, product(f.lager)));
    // Copy -> Beer -> Ales, and the copy would take a place inside Ales.
    await expect(
      app((tx) =>
        duplicateSection(tx, drinks.id, {
          internalName: "Copy",
          memberIds: [nested.id],
          replaceIn: { sectionId: ales.id, memberId: inAles.id },
        }),
      ),
    ).rejects.toMatchObject({
      code: "menu_section.member_cycle",
      params: { sectionId: ales.id, childSectionId: expect.any(String) },
    });
    expect(refs((await app((tx) => readSection(tx, ales.id))).members)).toEqual([product(f.lager)]);
    // Keeping only the product leaves nothing to lead back to Ales.
    const plain = await app((tx) => readSection(tx, drinks.id));
    const copy = await app((tx) =>
      duplicateSection(tx, drinks.id, {
        internalName: "Copy",
        memberIds: [plain.members[0]!.id],
        replaceIn: { sectionId: ales.id, memberId: inAles.id },
      }),
    );
    expect(refs((await app((tx) => readSection(tx, ales.id))).members)).toEqual([section(copy.id)]);
  });
});

describe("delete and usages", () => {
  it("names every menu and list using a section, and deleting it removes it from all of them", async () => {
    const f = await fixture();
    const lunchRoot = await menuOwned("menu_root", f.lunchMenu);
    const dinnerRoot = await menuOwned("menu_root", f.dinnerMenu);
    const layout = await menuOwned("home_layout", f.dinnerMenu);
    const drinks = await create("Drinks");
    const favourites = await create("Favourites");
    const beer = await create("Beer");
    await app((tx) => addMember(tx, beer.id, product(f.lager)));
    await app((tx) => addMember(tx, drinks.id, section(beer.id)));
    await app((tx) => addMember(tx, drinks.id, product(f.water)));
    await app((tx) => addMember(tx, favourites.id, product(f.lemonade)));
    await app((tx) => addMember(tx, favourites.id, section(drinks.id)));
    await app((tx) => addMember(tx, lunchRoot, section(drinks.id)));
    await app((tx) => addMember(tx, dinnerRoot, section(favourites.id)));
    await rawMember(layout, section(drinks.id), 0);
    const category = async () =>
      (
        await fx.db.execute<{ category_id: string | null }>(
          sql`select category_id from products where id = ${f.water}`,
        )
      ).rows[0]!.category_id;

    expect(await app((tx) => sectionUsages(tx, drinks.id))).toEqual({
      menus: [
        { id: f.dinnerMenu, name: "Dinner menu" },
        { id: f.lunchMenu, name: "Lunch menu" },
      ],
      sections: [{ id: favourites.id, internalName: "Favourites" }],
    });
    expect(await app((tx) => sectionUsages(tx, favourites.id))).toEqual({
      menus: [{ id: f.dinnerMenu, name: "Dinner menu" }],
      sections: [],
    });

    hook.mockClear();
    await app((tx) => deleteSection(tx, drinks.id));
    expect(hook).toHaveBeenCalledTimes(1);
    // Sorted by id, as `menusContaining` answers them.
    expect(hook.mock.calls[0]![1]).toEqual([f.dinnerMenu, f.lunchMenu].sort());
    await expect(app((tx) => readSection(tx, drinks.id))).rejects.toMatchObject({
      code: "menu_section.not_found",
    });
    for (const list of [lunchRoot, layout]) {
      expect((await app((tx) => readSection(tx, list))).members).toEqual([]);
    }
    const left = (await app((tx) => readSection(tx, favourites.id))).members;
    expect(refs(left)).toEqual([product(f.lemonade)]);
    // The nested section and the products survive, and the product keeps its category.
    expect(refs((await app((tx) => readSection(tx, beer.id))).members)).toEqual([product(f.lager)]);
    expect(await category()).toBe(f.category);
  });
});

describe("every library section's usages at once", () => {
  it("answers each library section as sectionUsages does, a menu's own lists left out", async () => {
    const f = await fixture();
    const lunchRoot = await menuOwned("menu_root", f.lunchMenu);
    const dinnerRoot = await menuOwned("menu_root", f.dinnerMenu);
    const layout = await menuOwned("home_layout", f.dinnerMenu);
    const drinks = await create("Drinks");
    const favourites = await create("Favourites");
    const beer = await create("Beer");
    const unused = await create("Unused");
    const alsoHolds = await create("Also holds beer");
    await app((tx) => addMember(tx, drinks.id, section(beer.id)));
    await app((tx) => addMember(tx, alsoHolds.id, section(beer.id)));
    await app((tx) => addMember(tx, favourites.id, section(drinks.id)));
    await app((tx) => addMember(tx, lunchRoot, section(drinks.id)));
    await app((tx) => addMember(tx, dinnerRoot, section(favourites.id)));
    await rawMember(layout, section(unused.id), 0);
    await app((tx) => createSection(tx, { internalName: "Empty" }));

    const all = await app((tx) => librarySectionUsages(tx));
    const library = await app((tx) => listSections(tx));
    expect(Object.keys(all).sort()).toEqual(library.map((row) => row.id).sort());
    for (const row of library)
      expect(all[row.id], row.internalName).toEqual(await app((tx) => sectionUsages(tx, row.id)));
    // Beer is reached by both menus through nesting, and held by two library sections.
    expect(all[beer.id]).toEqual({
      menus: [
        { id: f.dinnerMenu, name: "Dinner menu" },
        { id: f.lunchMenu, name: "Lunch menu" },
      ],
      sections: [
        { id: alsoHolds.id, internalName: "Also holds beer" },
        { id: drinks.id, internalName: "Drinks" },
      ],
    });
    // A home layout holding a section names its menu.
    expect(all[unused.id]).toEqual({
      menus: [{ id: f.dinnerMenu, name: "Dinner menu" }],
      sections: [],
    });
    expect(all[lunchRoot]).toBeUndefined();
  });

  it("answers an empty map when the library is empty", async () => {
    await fixture();
    expect(await app((tx) => librarySectionUsages(tx))).toEqual({});
  });
});

describe("the structure hook", () => {
  it("is told once per member write, with the menus the written list reaches", async () => {
    const f = await fixture();
    const lunchRoot = await menuOwned("menu_root", f.lunchMenu);
    const drinks = await create("Drinks");
    await app((tx) => addMember(tx, lunchRoot, section(drinks.id)));
    const expectOneCall = (menus: string[]) => {
      expect(hook).toHaveBeenCalledTimes(1);
      expect(hook.mock.calls[0]![1]).toEqual(menus);
      hook.mockClear();
    };
    hook.mockClear();
    const water = await app((tx) => addMember(tx, drinks.id, product(f.water)));
    expectOneCall([f.lunchMenu]);
    await app((tx) => addProducts(tx, drinks.id, [f.lemonade]));
    expectOneCall([f.lunchMenu]);
    await app((tx) => moveMember(tx, drinks.id, water.id, 1));
    expectOneCall([f.lunchMenu]);
    await app((tx) => removeMember(tx, drinks.id, water.id));
    expectOneCall([f.lunchMenu]);
    const specials = await create("Specials");
    await app((tx) => addMember(tx, specials.id, product(f.water)));
    expectOneCall([]);
    await app((tx) => duplicateSection(tx, drinks.id, { internalName: "Copy", memberIds: [] }));
    expectOneCall([]);
    // Details are not structure.
    await app((tx) => updateSection(tx, drinks.id, { internalName: "Cold drinks" }));
    expect(hook).not.toHaveBeenCalled();
  });

  it("works out a section delete's menus before the cascade removes the link", async () => {
    const f = await fixture();
    const lunchRoot = await menuOwned("menu_root", f.lunchMenu);
    const drinks = await create("Drinks");
    await app((tx) => addMember(tx, lunchRoot, section(drinks.id)));
    hook.mockClear();
    await app((tx) => deleteSection(tx, drinks.id));
    expect(hook.mock.calls[0]![1]).toEqual([f.lunchMenu]);
  });
});
