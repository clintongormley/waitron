import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTransaction, type Transaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { racePair, seedLegacySellingUnits, useCatalogueDb } from "../test/fixtures.js";
import { createCatalogue, createProduct } from "./operations.js";
import { loadSectionGraph, wouldCreateCycle } from "./section-graph.js";
import { addMember, createSection, readSection } from "./sections.js";

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
    return { menu: menu.id, water: await make("Water"), beer: await make("Beer") };
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

describe("sections_owner_ck", () => {
  it("ties a menu owner to the two menu-owned roles and to nothing else", async () => {
    const { menu } = await fixture();
    await insertSection("library", null);
    await insertSection("menu_root", menu);
    await insertSection("home_layout", menu);
    for (const [role, owner] of [
      ["library", menu],
      ["menu_root", null],
      ["home_layout", null],
    ] as const)
      await expect(insertSection(role, owner)).rejects.toMatchObject({
        message: expect.stringContaining("sections_owner_ck"),
        errcode: 275,
      });
    await expect(insertSection("tile", null)).rejects.toMatchObject({
      message: expect.stringContaining("sections_role_ck"),
      errcode: 275,
    });
    const count = await fx.db.execute<{ n: number }>(sql`select count(*) as n from sections`);
    expect(count.rows[0]!.n).toBe(3);
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
    const { water } = await fixture();
    const list = await app((tx) => createSection(tx, { internalName: "List" }));
    const child = await app((tx) => createSection(tx, { internalName: "Child" }));
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
