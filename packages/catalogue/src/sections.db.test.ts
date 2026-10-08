import { createIncludedMenu as createSection } from "../test/included-menu.js";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction, type Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { racePair, seedLegacySellingUnits, useCatalogueDb } from "../test/fixtures.js";
import { and } from "drizzle-orm";
import { readMenuHome } from "./menu-home.js";
import { requireMenuRoot } from "./menu-structure.js";
import { menuItems } from "./schema/menu.js";
import { sectionMembers } from "./schema/sections.js";
import { createCatalogue, createProduct, updateMenuItem } from "./operations.js";
import { loadSectionGraph, wouldCreateCycle } from "./section-graph.js";
import {
  addMember,
  createSectionIn,
  moveMembersInto,
  readSection,
  removeMembers,
  replaceMember,
} from "./sections.js";

/**
 * Sections against the database itself: two member writes started together, and the constraints
 * on `sections` and `section_members` tried with real offending writes, each beside an accepted
 * one. `racePair` (`test/fixtures.ts`) carries the mechanism, the measurement and the control.
 */
const fx = useCatalogueDb();
const app = <T>(fn: (tx: Transaction) => Promise<T>) => withTransaction(fx.db, fn);

async function fixture() {
  await seedTenant(fx.db);
  await seedLegacySellingUnits(fx.db);
  return app(async (tx) => {
    const menu = await createCatalogue(tx, { name: "Lunch menu" });
    const make = async (name: string) =>
      (
        await createProduct(tx, {
          catalogueId: menu.id,
          categoryId: null,
          name: `${name} (staff)`,
          customerName: { en: `${name} (customer)` },
          kitchenName: `${name} (kitchen)`,
          pricingUnit: "each",
          unitPrice: "2",
          vatClass: "general",
        })
      ).id;
    return {
      menu: menu.id,
      water: await make("Water"),
      beer: await make("Beer"),
      juice: await make("Juice"),
    };
  });
}

// `async`, so a refusal the driver throws synchronously arrives as a rejected promise.
const insertSection = async (role: string, owner: string | null) =>
  fx.db.execute(sql`
    insert into sections (id, internal_name, names, role, owner_menu_id)
    values (${crypto.randomUUID()}, 'Row', '{}', ${role}, ${owner})`);

const insertMember = async (
  sectionId: string,
  productId: string | null,
  childSectionId: string | null,
  position = 0,
) =>
  fx.db.execute(sql`
    insert into section_members (id, section_id, position, product_id, child_section_id)
    values (${crypto.randomUUID()}, ${sectionId}, ${position}, ${productId}, ${childSectionId})`);

it("lets exactly one of two opposing containments land when both start together", async () => {
  await fixture();
  const a = await app((tx) => createSection(tx, { internalName: "A" }));
  const b = await app((tx) => createSection(tx, { internalName: "B" }));
  const [first, second] = await racePair(
    fx.db,
    (tx) => addMember(tx, a.id, { kind: "section", sectionId: b.id }),
    (tx) => addMember(tx, b.id, { kind: "section", sectionId: a.id }),
  );
  expect(first.status).toBe("fulfilled");
  expect(second).toMatchObject({
    status: "rejected",
    reason: { code: "menu_section.member_cycle" },
  });
  expect((await app((tx) => readSection(tx, b.id))).members).toEqual([]);
  const graph = await app((tx) => loadSectionGraph(tx));
  // A graph with a loop would say that A can hold itself through B.
  expect(wouldCreateCycle(graph, a.id, b.id)).toBe(false);
  expect(graph.children(a.id).map((member) => member.ref)).toEqual([
    { kind: "section", sectionId: b.id },
  ]);
});

describe("section ownership", () => {
  it("requires an existing owner for every role", async () => {
    const { menu } = await fixture();
    for (const role of ["section", "menu_root", "home_layout"]) {
      await insertSection(role, menu);
      await expect(insertSection(role, null)).rejects.toMatchObject({ errcode: 1299 });
      await expect(insertSection(role, "missing")).rejects.toMatchObject({ errcode: 787 });
    }
    await expect(insertSection("library", menu)).rejects.toMatchObject({
      message: expect.stringContaining("sections_role_ck"),
      errcode: 275,
    });
    expect(
      (
        await fx.db.execute<{ n: number }>(
          sql`select count(*) as n from sections where internal_name='Row'`,
        )
      ).rows[0]!.n,
    ).toBe(3);
  });
});

describe("section_members", () => {
  it("holds exactly one of a product and a section", async () => {
    const { water } = await fixture();
    const list = await app((tx) => createSection(tx, { internalName: "List" }));
    const child = await app((tx) => createSection(tx, { internalName: "Child" }));
    await insertMember(list.id, water, null);
    await insertMember(list.id, null, child.id);
    for (const [productId, childId] of [
      [null, null],
      [water, child.id],
    ])
      await expect(insertMember(list.id, productId, childId)).rejects.toMatchObject({
        message: expect.stringContaining("section_members_one_ref_ck"),
        errcode: 275,
      });
  });

  it("allows many rows with no product in one list and refuses the same product or section twice", async () => {
    const { water, beer } = await fixture();
    const list = await app((tx) => createSection(tx, { internalName: "List" }));
    const [one, two] = [
      await app((tx) => createSection(tx, { internalName: "One" })),
      await app((tx) => createSection(tx, { internalName: "Two" })),
    ];
    // Two section members leave `product_id` null twice, and two product members leave
    // `child_section_id` null twice; neither unique index counts a null as a value.
    await insertMember(list.id, null, one!.id);
    await insertMember(list.id, null, two!.id);
    await insertMember(list.id, water, null);
    await insertMember(list.id, beer, null);
    await expect(insertMember(list.id, water, null)).rejects.toMatchObject({
      message: expect.stringContaining("section_members.section_id, section_members.product_id"),
      errcode: 2067,
    });
    await expect(insertMember(list.id, null, one!.id)).rejects.toMatchObject({
      message: expect.stringContaining(
        "section_members.section_id, section_members.child_section_id",
      ),
      errcode: 2067,
    });
    // Positions are not unique: the order is by position, then id.
    await insertMember(
      list.id,
      null,
      (await app((tx) => createSection(tx, { internalName: "Three" }))).id,
      0,
    );
    const count = await fx.db.execute<{ n: number }>(
      sql`select count(*) as n from section_members where section_id = ${list.id}`,
    );
    expect(count.rows[0]!.n).toBe(5);
  });

  it("goes with its list, its child section or its product", async () => {
    const { water, menu } = await fixture();
    const list = await app((tx) => createSection(tx, { internalName: "List" }));
    const child = { id: crypto.randomUUID() };
    await fx.db.execute(
      sql`insert into sections(id,internal_name,owner_menu_id) values (${child.id},'Child',${menu})`,
    );
    const other = await app((tx) => createSection(tx, { internalName: "Other" }));
    await insertMember(list.id, water, null);
    await insertMember(list.id, null, child.id);
    await insertMember(other.id, water, null);
    await fx.db.execute(sql`delete from sections where id = ${child.id}`);
    await fx.db.execute(sql`delete from products where id = ${water}`);
    const rows = await fx.db.execute<{ n: number }>(sql`select count(*) as n from section_members`);
    expect(rows.rows[0]!.n).toBe(0);
  });
});

describe("an include's folder setting", () => {
  async function includeB() {
    await fixture();
    const a = await app((tx) => createSection(tx, { internalName: "A" }));
    const b = await app((tx) => createSection(tx, { internalName: "B" }));
    const member = await app((tx) => addMember(tx, a.id, { kind: "section", sectionId: b.id }));
    await fx.db
      .update(sectionMembers)
      .set({ showAsFolder: false, folderOverrides: { names: { en: "Bar" } } })
      .where(eq(sectionMembers.id, member.id));
    return { rootA: a.id, memberId: member.id };
  }

  it("loads show_as_folder and folder_overrides through loadSectionGraph", async () => {
    const { memberId } = await includeB();
    expect((await app(loadSectionGraph)).folder(memberId)).toEqual({
      showAsFolder: false,
      overrides: { names: { en: "Bar" } },
    });
  });

  it("a replaced include starts as a folder that follows", async () => {
    const { rootA, memberId } = await includeB();
    const c = await app((tx) => createSection(tx, { internalName: "C" }));
    await app((tx) => replaceMember(tx, rootA, memberId, { kind: "section", sectionId: c.id }));
    const rows = await fx.db.execute<{ show_as_folder: number; folder_overrides: string }>(
      sql`select show_as_folder, folder_overrides from section_members where id = ${memberId}`,
    );
    expect(rows.rows).toEqual([{ show_as_folder: 1, folder_overrides: "{}" }]);
  });

  it("an include replaced by the same menu keeps its folder setting", async () => {
    const { rootA, memberId } = await includeB();
    const graph = await app(loadSectionGraph);
    const held = graph.children(rootA).find((member) => member.id === memberId)!.ref;
    await app((tx) => replaceMember(tx, rootA, memberId, held));
    expect((await app(loadSectionGraph)).folder(memberId)).toEqual({
      showAsFolder: false,
      overrides: { names: { en: "Bar" } },
    });
  });
});

describe("moving and removing several members", () => {
  /** Lunch's root holds A, B and C; A holds water then A1 (which holds juice); B holds beer. */
  async function lists() {
    const f = await fixture();
    return app(async (tx) => {
      const root = await requireMenuRoot(tx, f.menu);
      const owned = async (list: string, internalName: string) =>
        (await createSectionIn(tx, list, { internalName })).id;
      const [a, b, c] = [await owned(root, "A"), await owned(root, "B"), await owned(root, "C")];
      const put = async (list: string, productId: string) =>
        (await addMember(tx, list, { kind: "product", productId })).id;
      const aWater = await put(a, f.water);
      const a1 = await owned(a, "A1");
      return {
        ...f,
        root,
        a,
        b,
        c,
        a1,
        aWater,
        a1Juice: await put(a1, f.juice),
        bBeer: await put(b, f.beer),
      };
    });
  }

  type Rows = {
    id: string;
    position: number;
    productId: string | null;
    childSectionId: string | null;
  }[];
  const membersIn = async (list: string): Promise<Rows> =>
    fx.db
      .select({
        id: sectionMembers.id,
        position: sectionMembers.position,
        productId: sectionMembers.productId,
        childSectionId: sectionMembers.childSectionId,
      })
      .from(sectionMembers)
      .where(eq(sectionMembers.sectionId, list))
      .orderBy(sectionMembers.position);
  const ids = async (list: string) => (await membersIn(list)).map((row) => row.id);
  const positions = async (list: string) => (await membersIn(list)).map((row) => row.position);

  it("moves products from two lists to the end of a third, in the order given", async () => {
    const f = await lists();
    const held = await app(
      async (tx) => (await addMember(tx, f.c, { kind: "product", productId: f.juice })).id,
    );
    const moved = await app((tx) =>
      moveMembersInto(tx, f.c, [
        { listId: f.b, memberId: f.bBeer },
        { listId: f.a, memberId: f.aWater },
      ]),
    );
    expect(moved.map((member) => [member.id, member.position])).toEqual([
      [held, 0],
      [f.bBeer, 1],
      [f.aWater, 2],
    ]);
    expect(await ids(f.c)).toEqual([held, f.bBeer, f.aWater]);
    expect(await positions(f.c)).toEqual([0, 1, 2]);
    expect(await ids(f.b)).toEqual([]);
    // A keeps A1, renumbered from 1 to 0.
    expect(await membersIn(f.a)).toEqual([
      { id: expect.any(String), position: 0, productId: null, childSectionId: f.a1 },
    ]);
  });

  it("puts the moved members at a given position", async () => {
    const f = await lists();
    const moved = await app((tx) =>
      moveMembersInto(
        tx,
        f.root,
        [
          { listId: f.b, memberId: f.bBeer },
          { listId: f.a, memberId: f.aWater },
        ],
        1,
      ),
    );
    const sectionsAt = (await membersIn(f.root)).map((row) => row.childSectionId ?? row.productId);
    expect(sectionsAt).toEqual([f.a, f.beer, f.water, f.b, f.c]);
    expect(await positions(f.root)).toEqual([0, 1, 2, 3, 4]);
    expect(moved.map((member) => member.position)).toEqual([0, 1, 2, 3, 4]);
  });

  it("re-places a member already in the destination, counting the position without the moved", async () => {
    const f = await lists();
    const rootIds = await ids(f.root); // A, B, C
    // Moving A (index 0 of the root) and B's beer to position 1 of [B, C] gives B, A, beer, C.
    await app((tx) =>
      moveMembersInto(
        tx,
        f.root,
        [
          { listId: f.root, memberId: rootIds[0]! },
          { listId: f.b, memberId: f.bBeer },
        ],
        1,
      ),
    );
    expect(await ids(f.root)).toEqual([rootIds[1], rootIds[0], f.bBeer, rootIds[2]]);
    expect(await positions(f.root)).toEqual([0, 1, 2, 3]);
  });

  it("moves an owned section under another, keeping its own children under it", async () => {
    const f = await lists();
    const aInRoot = (await ids(f.root))[0]!;
    await app((tx) => moveMembersInto(tx, f.c, [{ listId: f.root, memberId: aInRoot }]));
    expect(await ids(f.c)).toEqual([aInRoot]);
    expect((await membersIn(f.c))[0]!.childSectionId).toBe(f.a);
    expect((await membersIn(f.root)).map((row) => row.childSectionId)).toEqual([f.b, f.c]);
    expect(await positions(f.root)).toEqual([0, 1]);
    expect((await membersIn(f.a)).map((row) => row.productId ?? row.childSectionId)).toEqual([
      f.water,
      f.a1,
    ]);
    expect((await membersIn(f.a1)).map((row) => row.productId)).toEqual([f.juice]);
  });

  it("keeps the menu's price for a moved product", async () => {
    const f = await lists();
    const offer = async () =>
      (
        await fx.db
          .select({ id: menuItems.id, grossPrice: menuItems.grossPrice })
          .from(menuItems)
          .where(and(eq(menuItems.menuId, f.menu), eq(menuItems.productId, f.water)))
      )[0]!;
    const before = await offer();
    await app((tx) => updateMenuItem(tx, f.menu, before.id, { grossPrice: "3.10" }));
    await app((tx) => moveMembersInto(tx, f.b, [{ listId: f.a, memberId: f.aWater }]));
    expect(await offer()).toEqual({ id: before.id, grossPrice: 310 });
  });

  it("keeps an include's folder setting with its member", async () => {
    const f = await lists();
    const other = await app((tx) => createSection(tx, { internalName: "Other" }));
    const include = await app(
      async (tx) => (await addMember(tx, f.a, { kind: "section", sectionId: other.id })).id,
    );
    await fx.db
      .update(sectionMembers)
      .set({ showAsFolder: false, folderOverrides: { names: { en: "Bar" } } })
      .where(eq(sectionMembers.id, include));
    await app((tx) => moveMembersInto(tx, f.b, [{ listId: f.a, memberId: include }]));
    expect(await ids(f.b)).toEqual([f.bBeer, include]);
    expect((await app(loadSectionGraph)).folder(include)).toEqual({
      showAsFolder: false,
      overrides: { names: { en: "Bar" } },
    });
  });

  describe("refuses the whole move", () => {
    async function refused(move: (tx: Transaction) => Promise<unknown>, error: object) {
      const before = await fx.db.select().from(sectionMembers).orderBy(sectionMembers.id);
      await expect(app(move)).rejects.toMatchObject(error);
      expect(await fx.db.select().from(sectionMembers).orderBy(sectionMembers.id)).toEqual(before);
    }

    it("of a section into itself", async () => {
      const f = await lists();
      const aInRoot = (await ids(f.root))[0]!;
      await refused((tx) => moveMembersInto(tx, f.a, [{ listId: f.root, memberId: aInRoot }]), {
        code: "menu_section.member_cycle",
        params: { sectionId: f.a, childSectionId: f.a },
      });
    });

    it("of a section into its descendant", async () => {
      const f = await lists();
      const aInRoot = (await ids(f.root))[0]!;
      await refused((tx) => moveMembersInto(tx, f.a1, [{ listId: f.root, memberId: aInRoot }]), {
        code: "menu_section.member_cycle",
        params: { sectionId: f.a1, childSectionId: f.a },
      });
    });

    it("of a product the destination already holds", async () => {
      const f = await lists();
      await app((tx) => addMember(tx, f.b, { kind: "product", productId: f.water }));
      await refused((tx) => moveMembersInto(tx, f.b, [{ listId: f.a, memberId: f.aWater }]), {
        code: "menu_section.member_duplicate",
        params: { sectionId: f.b },
      });
    });

    it("of two members holding the same product, with the domain code rather than the index's", async () => {
      const f = await lists();
      const bWater = await app(
        async (tx) => (await addMember(tx, f.b, { kind: "product", productId: f.water })).id,
      );
      await refused(
        (tx) =>
          moveMembersInto(tx, f.c, [
            { listId: f.a, memberId: f.aWater },
            { listId: f.b, memberId: bWater },
          ]),
        { code: "menu_section.member_duplicate", params: { sectionId: f.c } },
      );
    });

    it("of an unknown member", async () => {
      const f = await lists();
      await refused((tx) => moveMembersInto(tx, f.c, [{ listId: f.a, memberId: f.bBeer }]), {
        code: "menu_section.not_found",
        params: { sectionId: f.a, memberId: f.bBeer },
      });
    });

    it("naming a member twice, or none", async () => {
      const f = await lists();
      await refused(
        (tx) =>
          moveMembersInto(tx, f.c, [
            { listId: f.a, memberId: f.aWater },
            { listId: f.a, memberId: f.aWater },
          ]),
        { code: "menu_section.invalid", params: { field: "members" } },
      );
      await refused((tx) => moveMembersInto(tx, f.c, []), {
        code: "menu_section.invalid",
        params: { field: "members" },
      });
    });

    it("to a bad position", async () => {
      const f = await lists();
      for (const position of [-1, 0.5])
        await refused(
          (tx) => moveMembersInto(tx, f.c, [{ listId: f.a, memberId: f.aWater }], position),
          { code: "menu_section.invalid", params: { field: "position" } },
        );
    });

    it("into a list another menu owns", async () => {
      const f = await lists();
      const other = await app((tx) => createSection(tx, { internalName: "Other" }));
      await refused((tx) => moveMembersInto(tx, other.id, [{ listId: f.a, memberId: f.aWater }]), {
        code: "menu_section.invalid",
        params: { field: "listId" },
      });
    });

    it("into the Device Home Page", async () => {
      const f = await lists();
      const home = (await app((tx) => readMenuHome(tx, f.menu))).homeSectionId;
      await refused((tx) => moveMembersInto(tx, home, [{ listId: f.a, memberId: f.aWater }]), {
        code: "menu_section.wrong_role",
        params: { sectionId: home, role: "home_layout" },
      });
    });
  });

  it("removes products from two lists and renumbers both", async () => {
    const f = await lists();
    const bJuice = await app(
      async (tx) => (await addMember(tx, f.b, { kind: "product", productId: f.juice })).id,
    );
    const aInRoot = (await ids(f.root))[0]!;
    const aA1 = (await ids(f.a))[1]!;
    await app((tx) =>
      removeMembers(tx, [
        { listId: f.a, memberId: f.aWater },
        { listId: f.b, memberId: f.bBeer },
      ]),
    );
    expect(await membersIn(f.a)).toEqual([
      { id: aA1, position: 0, productId: null, childSectionId: f.a1 },
    ]);
    expect(await membersIn(f.b)).toEqual([
      { id: bJuice, position: 0, productId: f.juice, childSectionId: null },
    ]);
    expect((await ids(f.root))[0]).toBe(aInRoot);
  });

  it("refuses a removal holding an owned section and removes nothing", async () => {
    const f = await lists();
    const aInRoot = (await ids(f.root))[0]!;
    const before = await fx.db.select().from(sectionMembers).orderBy(sectionMembers.id);
    await expect(
      app((tx) =>
        removeMembers(tx, [
          { listId: f.a, memberId: f.aWater },
          { listId: f.root, memberId: aInRoot },
        ]),
      ),
    ).rejects.toMatchObject({
      code: "menu_section.wrong_role",
      params: { sectionId: f.a, role: "section" },
    });
    expect(await fx.db.select().from(sectionMembers).orderBy(sectionMembers.id)).toEqual(before);
  });

  it("refuses a removal naming a member twice, none, or one its list does not hold", async () => {
    const f = await lists();
    for (const [members, error] of [
      [
        [
          { listId: f.a, memberId: f.aWater },
          { listId: f.a, memberId: f.aWater },
        ],
        { code: "menu_section.invalid", params: { field: "members" } },
      ],
      [[], { code: "menu_section.invalid", params: { field: "members" } }],
      [
        [{ listId: f.b, memberId: f.aWater }],
        { code: "menu_section.not_found", params: { sectionId: f.b, memberId: f.aWater } },
      ],
    ] as const)
      await expect(app((tx) => removeMembers(tx, [...members]))).rejects.toMatchObject(error);
    expect(await ids(f.a)).toContain(f.aWater);
  });
});
