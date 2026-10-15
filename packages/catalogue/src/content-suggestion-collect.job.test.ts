import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CORE_MIGRATIONS, products, withTransaction, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import type { ContentLanguages } from "@waitron/shared";
import { CATALOGUE_MIGRATIONS } from "./migrations.js";
import { createCategory } from "./categories.js";
import {
  createCatalogue,
  createProduct,
  deactivateCatalogue,
  deactivateProduct,
} from "./operations.js";
import { writeContentLanguages } from "./content-languages.js";
import type { HouseStyleExample, SuggestionItem } from "./content-suggestion-types.js";
import { menuDetails } from "./schema/menu.js";
import { sections } from "./schema/sections.js";
import { optionLabels, optionLists } from "./schema/options.js";
import { extraLists } from "./schema/extras.js";
import { units } from "./schema/units.js";
import { contentSuggestionJobs, contentSuggestions } from "./schema/suggestions.js";
import { startSuggestionRun } from "./content-suggestion-jobs.js";
import { addOversizedFamily } from "../test/suggestion-fixture.js";
import {
  buildSuggestionJob,
  collectSuggestionItems,
  HOUSE_STYLE_BYTE_LIMIT,
  HOUSE_STYLE_LIMIT,
  JOB_BYTE_LIMIT,
  JOB_ITEM_LIMIT,
  readHouseStyle,
  TEXT_LIMIT,
  type SuggestionJobDraft,
} from "./content-suggestion-collect.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS] });
const THREE: ContentLanguages = { defaultLanguage: "ca", languages: ["ca", "es", "en"] };
const context = { fallbackLanguage: "ca", required: [] };
const LUNCH_NAMES = { ca: "CLIENT-CA Dinar", es: "CLIENT-ES Dinar", en: "CLIENT-EN Dinar" };

interface Lunch {
  menuId: string;
  rootId: string;
}
interface Job {
  version: number;
  country: string;
  languages: { default: string; enabled: string[] };
  items: SuggestionItem[];
  houseStyle: HouseStyleExample[];
}

async function rootOf(tx: Transaction, menuId: string): Promise<string> {
  const [row] = await tx
    .select({ root: menuDetails.rootSectionId })
    .from(menuDetails)
    .where(eq(menuDetails.menuId, menuId));
  return row!.root;
}

/** Seeds the taxpayer (country "ES"), saves ca, es and en, and makes Lunch with complete names. */
async function inVenue<T>(body: (tx: Transaction, lunch: Lunch) => Promise<T>): Promise<T> {
  await seedTenant(suite.db);
  return withTransaction(suite.db, async (tx) => {
    await writeContentLanguages(tx, THREE);
    const menu = await createCatalogue(tx, { name: "STAFF Lunch", names: LUNCH_NAMES });
    return body(tx, { menuId: menu.id, rootId: await rootOf(tx, menu.id) });
  });
}

const all = (name: string) => ({
  ca: `CLIENT-CA ${name}`,
  es: `CLIENT-ES ${name}`,
  en: `CLIENT-EN ${name}`,
});

async function product(
  tx: Transaction,
  lunch: Lunch,
  name: string,
  customerName: Record<string, string> | null,
  categoryId: string | null = null,
): Promise<string> {
  const created = await createProduct(tx, {
    catalogueId: lunch.menuId,
    categoryId,
    unitId: null,
    name: `STAFF ${name}`,
    kitchenName: `KITCHEN ${name}`,
    customerName,
    unitPrice: "3.00",
    vatClass: "reduced",
  });
  return created.id;
}

/** Written directly: the variant editor refuses a customer-facing name with no default-language text. */
async function variant(
  tx: Transaction,
  lunch: Lunch,
  parentId: string,
  name: string,
  customerName: Record<string, string> | null,
): Promise<string> {
  const [row] = await tx
    .insert(products)
    .values({
      catalogueId: lunch.menuId,
      parentId,
      name: `STAFF ${name}`,
      kitchenName: `KITCHEN ${name}`,
      customerName,
    })
    .returning({ id: products.id });
  return row!.id;
}

async function manyProducts(
  tx: Transaction,
  lunch: Lunch,
  count: number,
  make: (index: number) => {
    name: string;
    customerName: Record<string, string> | null;
    categoryId?: string;
  },
): Promise<void> {
  for (let start = 0; start < count; start += 100) {
    const rows = Array.from({ length: Math.min(100, count - start) }, (_, offset) => {
      const { name, customerName, categoryId = null } = make(start + offset);
      return {
        catalogueId: lunch.menuId,
        categoryId,
        name,
        kitchenName: `KITCHEN ${start + offset}`,
        customerName,
        pricingUnit: "each",
        unitPrice: 300,
        vatClass: "reduced",
      };
    });
    await tx.insert(products).values(rows);
  }
}

async function manyVariants(
  tx: Transaction,
  lunch: Lunch,
  parentId: string,
  count: number,
  make: (index: number) => { name: string; customerName: Record<string, string> | null },
): Promise<void> {
  for (let start = 0; start < count; start += 100) {
    const rows = Array.from({ length: Math.min(100, count - start) }, (_, offset) => ({
      catalogueId: lunch.menuId,
      parentId,
      kitchenName: `KITCHEN variant ${start + offset}`,
      ...make(start + offset),
    }));
    await tx.insert(products).values(rows);
  }
}

async function optionList(
  tx: Transaction,
  name: string,
  customerName: Record<string, string> | null,
): Promise<string> {
  const [row] = await tx
    .insert(optionLists)
    .values({ name: `STAFF ${name}`, kitchenName: `KITCHEN ${name}`, customerName })
    .returning({ id: optionLists.id });
  return row!.id;
}

async function optionLabel(
  tx: Transaction,
  listId: string,
  name: string,
  customerName: Record<string, string> | null,
): Promise<string> {
  const [row] = await tx
    .insert(optionLabels)
    .values({ listId, name: `STAFF ${name}`, kitchenName: `KITCHEN ${name}`, customerName })
    .returning({ id: optionLabels.id });
  return row!.id;
}

async function extraList(
  tx: Transaction,
  name: string,
  customerName: Record<string, string> | null,
): Promise<string> {
  const [row] = await tx
    .insert(extraLists)
    .values({ name: `STAFF ${name}`, kitchenName: `KITCHEN ${name}`, customerName })
    .returning({ id: extraLists.id });
  return row!.id;
}

async function section(
  tx: Transaction,
  menuId: string,
  name: string,
  names: Record<string, string>,
): Promise<string> {
  const [row] = await tx
    .insert(sections)
    .values({ internalName: `STAFF ${name}`, names, ownerMenuId: menuId })
    .returning({ id: sections.id });
  return row!.id;
}

async function rename(tx: Transaction, productId: string, name: string): Promise<void> {
  await tx.update(products).set({ name }).where(eq(products.id, productId));
}

const parsed = (draft: SuggestionJobDraft | null): Job => JSON.parse(draft!.body) as Job;

describe("the house style", () => {
  it("spreads the house style across kinds and categories and stops at 300", async () => {
    await inVenue(async (tx, lunch) => {
      const a = await createCategory(tx, { name: "CAT A" });
      const b = await createCategory(tx, { name: "CAT B" });
      await manyProducts(tx, lunch, 400, (index) => ({
        name: `STAFF A-${index}`,
        customerName: { ca: `CLIENT-CA A-${index}` },
        categoryId: a.id,
      }));
      await manyProducts(tx, lunch, 5, (index) => ({
        name: `STAFF B-${index}`,
        customerName: { ca: `CLIENT-CA B-${index}` },
        categoryId: b.id,
      }));
      const list = await optionList(tx, "Punt", { ca: "CLIENT-CA Punt" });
      for (let index = 0; index < 5; index += 1)
        await optionLabel(tx, list, `Label ${index}`, { ca: `CLIENT-CA Label ${index}` });

      const examples = await readHouseStyle(tx, THREE.languages);
      expect(examples).toHaveLength(HOUSE_STYLE_LIMIT);
      expect(examples.filter((example) => example.staffName.startsWith("STAFF B-"))).toHaveLength(
        5,
      );
      expect(examples.filter((example) => example.kind === "option_label")).toHaveLength(5);
      expect(examples.filter((example) => example.kind === "option_list")).toHaveLength(1);
      expect(examples.filter((example) => example.kind === "menu")).toHaveLength(1);
    });
  });

  it("takes one example from each group in turn, each group in id order, and the limit cuts the list", async () => {
    await inVenue(async (tx, lunch) => {
      const a = await createCategory(tx, { name: "CAT A" });
      const b = await createCategory(tx, { name: "CAT B" });
      const firstA = await product(tx, lunch, "A1", { ca: "CLIENT-CA A1" }, a.id);
      const secondA = await product(tx, lunch, "A2", { ca: "CLIENT-CA A2" }, a.id);
      await product(tx, lunch, "B1", { ca: "CLIENT-CA B1" }, b.id);
      const [earlier, later] =
        firstA < secondA ? ["STAFF A1", "STAFF A2"] : ["STAFF A2", "STAFF A1"];

      expect(
        (await readHouseStyle(tx, THREE.languages)).map((example) => example.staffName),
      ).toEqual(["STAFF Lunch", earlier, "STAFF B1", later]);
      expect(
        (await readHouseStyle(tx, THREE.languages, 2)).map((example) => example.staffName),
      ).toEqual(["STAFF Lunch", earlier]);
    });
  });

  it("takes a live menu's section with a saved name", async () => {
    await inVenue(async (tx, lunch) => {
      await section(tx, lunch.menuId, "Postres", { ca: "CLIENT-CA Postres" });
      expect(await readHouseStyle(tx, THREE.languages)).toContainEqual({
        kind: "section",
        staffName: "STAFF Postres",
        names: { ca: "CLIENT-CA Postres" },
      });
    });
  });

  it("leaves out a name Cloud would refuse, a language the venue does not use, and anything gone", async () => {
    await inVenue(async (tx, lunch) => {
      const blankStaff = await product(tx, lunch, "Blank", { ca: "CLIENT-CA Blanc" });
      await rename(tx, blankStaff, "   ");
      const longStaff = await product(tx, lunch, "Long", { ca: "CLIENT-CA Llarg" });
      await rename(tx, longStaff, "S".repeat(TEXT_LIMIT + 1));
      await product(tx, lunch, "Pa", {
        ca: "C".repeat(TEXT_LIMIT + 1),
        es: "CLIENT-ES Pan",
        fr: "CLIENT-FR Pain",
      });
      await product(tx, lunch, "Oli", { ca: "  " });
      await product(tx, lunch, "Sal", null);
      const coca = await product(tx, lunch, "Coca", { ca: "CLIENT-CA Coca" });
      await deactivateProduct(tx, coca);
      const vermut = await product(tx, lunch, "Vermut", { ca: "CLIENT-CA Vermut" });
      await variant(tx, lunch, vermut, "Vermut gran", { ca: "CLIENT-CA Vermut gran" });
      await tx.update(products).set({ active: false }).where(eq(products.id, vermut));
      const vi = await product(tx, lunch, "Vi", { ca: "CLIENT-CA Vi" });
      await variant(tx, lunch, vi, "Copa", { ca: "CLIENT-CA Copa" });
      const spice = await optionList(tx, "Picant", { ca: "CLIENT-CA Picant" });
      await optionLabel(tx, spice, "Molt", { ca: "CLIENT-CA Molt" });
      await tx.update(optionLists).set({ active: false }).where(eq(optionLists.id, spice));
      const terrace = await createCatalogue(tx, {
        name: "STAFF Terrassa",
        names: { ca: "CLIENT-CA Terrassa" },
      });
      await section(tx, terrace.id, "Postres", { ca: "CLIENT-CA Postres" });
      await deactivateCatalogue(tx, terrace.id);
      await extraList(tx, "Salses", { ca: "CLIENT-CA Salses" });
      await tx
        .insert(units)
        .values({ name: { ca: "CLIENT-CA Ració" }, abbreviation: { ca: "r." }, precision: 0 });

      const byName = (a: HouseStyleExample, b: HouseStyleExample) =>
        a.staffName < b.staffName ? -1 : 1;
      expect([...(await readHouseStyle(tx, THREE.languages))].sort(byName)).toEqual(
        (
          [
            { kind: "variant", staffName: "STAFF Copa", names: { ca: "CLIENT-CA Copa" } },
            { kind: "menu", staffName: "STAFF Lunch", names: LUNCH_NAMES },
            { kind: "product", staffName: "STAFF Pa", names: { es: "CLIENT-ES Pan" } },
            { kind: "extra_list", staffName: "STAFF Salses", names: { ca: "CLIENT-CA Salses" } },
            { kind: "product", staffName: "STAFF Vi", names: { ca: "CLIENT-CA Vi" } },
          ] as HouseStyleExample[]
        ).sort(byName),
      );
    });
  });
});

describe("the job body", () => {
  it("carries the venue's country and languages, and the keys the contract names and no others", async () => {
    await inVenue(async (tx, lunch) => {
      const pa = await product(tx, lunch, "Pa", { ca: "CLIENT-CA Pa" });
      const draft = await buildSuggestionJob(tx, context, new Set());
      const job = parsed(draft);
      expect(Object.keys(job)).toEqual(["version", "country", "languages", "items", "houseStyle"]);
      expect(job).toMatchObject({
        version: 1,
        country: "ES",
        languages: { default: "ca", enabled: ["ca", "es", "en"] },
      });
      expect(job.items).toEqual([
        {
          ref: `product:${pa}`,
          kind: "product",
          family: `product:${pa}`,
          category: null,
          staffName: "STAFF Pa",
          existing: { ca: "CLIENT-CA Pa" },
          missing: ["es", "en"],
        },
      ]);
      expect(Object.keys(job.items[0]!)).toEqual([
        "ref",
        "kind",
        "family",
        "category",
        "staffName",
        "existing",
        "missing",
      ]);
      expect(job.houseStyle).toEqual([
        { kind: "menu", staffName: "STAFF Lunch", names: LUNCH_NAMES },
        { kind: "product", staffName: "STAFF Pa", names: { ca: "CLIENT-CA Pa" } },
      ]);
      expect(draft).toMatchObject({
        sent: { [`product:${pa}`]: ["es", "en"] },
        included: 1,
        heads: 0,
        remaining: 0,
      });
      expect(Buffer.byteLength(draft!.body)).toBe(draft!.bytes);
    });
  });

  it("returns null when nothing is missing", async () => {
    await inVenue(async (tx) => {
      expect(await buildSuggestionJob(tx, context, new Set())).toBeNull();
    });
  });

  it("sends a complete family head as context, once, with nothing missing, before its first member", async () => {
    await inVenue(async (tx, lunch) => {
      const beers = await createCategory(tx, { name: "TAP BEERS" });
      const cana = await product(tx, lunch, "Caña", all("Caña"), beers.id);
      const pinta = await variant(tx, lunch, cana, "Pinta", {
        ca: "CLIENT-CA Pinta",
        en: "CLIENT-EN Pint",
      });
      const quinto = await variant(tx, lunch, cana, "Quinto", {
        ca: "CLIENT-CA Quint",
        en: "CLIENT-EN Fifth",
      });
      const punto = await optionList(tx, "Punto", all("Punto"));
      const poco = await optionLabel(tx, punto, "Poco", {
        ca: "CLIENT-CA Poc",
        es: "CLIENT-ES Poco",
      });
      const plats = await section(tx, lunch.menuId, "Plats", {
        ca: "CLIENT-CA Plats",
        en: "CLIENT-EN Mains",
      });

      const draft = await buildSuggestionJob(tx, context, new Set());
      const items = parsed(draft).items;
      const [first, second] = [`variant:${pinta}`, `variant:${quinto}`].sort();
      expect(items.map((item) => item.ref)).toEqual([
        `product:${cana}`,
        first,
        second,
        `option_list:${punto}`,
        `option_label:${poco}`,
        `menu:${lunch.rootId}`,
        `section:${plats}`,
      ]);
      expect(items[0]).toEqual({
        ref: `product:${cana}`,
        kind: "product",
        family: `product:${cana}`,
        category: "TAP BEERS",
        staffName: "STAFF Caña",
        existing: all("Caña"),
        missing: [],
      });
      expect(items[3]).toEqual({
        ref: `option_list:${punto}`,
        kind: "option_list",
        family: `option_list:${punto}`,
        category: null,
        staffName: "STAFF Punto",
        existing: all("Punto"),
        missing: [],
      });
      expect(items[5]).toEqual({
        ref: `menu:${lunch.rootId}`,
        kind: "menu",
        family: `menu:${lunch.rootId}`,
        category: null,
        staffName: "STAFF Lunch",
        existing: LUNCH_NAMES,
        missing: [],
      });
      expect(draft!.sent).toEqual({
        [`variant:${pinta}`]: ["es"],
        [`variant:${quinto}`]: ["es"],
        [`option_label:${poco}`]: ["en"],
        [`section:${plats}`]: ["es"],
      });
      expect(draft).toMatchObject({ included: 7, heads: 3, remaining: 0 });
      expect(Object.keys(draft!.sent)).toHaveLength(draft!.included - draft!.heads);
    });
  });

  it("sends an excluded head again as context, and a head with its own gaps once, as an item", async () => {
    await inVenue(async (tx, lunch) => {
      const cana = await product(tx, lunch, "Caña", {
        ca: "CLIENT-CA Canya",
        en: "CLIENT-EN Half pint",
      });
      const pinta = await variant(tx, lunch, cana, "Pinta", {
        ca: "CLIENT-CA Pinta",
        en: "CLIENT-EN Pint",
      });

      const later = await buildSuggestionJob(tx, context, new Set([`product:${cana}`]));
      expect(parsed(later).items).toEqual([
        {
          ref: `product:${cana}`,
          kind: "product",
          family: `product:${cana}`,
          category: null,
          staffName: "STAFF Caña",
          existing: { ca: "CLIENT-CA Canya", en: "CLIENT-EN Half pint" },
          missing: [],
        },
        {
          ref: `variant:${pinta}`,
          kind: "variant",
          family: `product:${cana}`,
          category: null,
          staffName: "STAFF Pinta",
          existing: { ca: "CLIENT-CA Pinta", en: "CLIENT-EN Pint" },
          missing: ["es"],
        },
      ]);
      expect(later!.sent).toEqual({ [`variant:${pinta}`]: ["es"] });
      expect(later).toMatchObject({ included: 2, heads: 1, remaining: 0 });

      const first = await buildSuggestionJob(tx, context, new Set());
      expect(parsed(first).items.map(({ ref, missing }) => ({ ref, missing }))).toEqual([
        { ref: `product:${cana}`, missing: ["es"] },
        { ref: `variant:${pinta}`, missing: ["es"] },
      ]);
      expect(first).toMatchObject({ included: 2, heads: 0 });
    });
  });

  it("sends a head whose own gaps all have waiting suggestions as context, before its first member", async () => {
    await inVenue(async (tx, lunch) => {
      const cana = await product(tx, lunch, "Caña", {
        ca: "CLIENT-CA Canya",
        en: "CLIENT-EN Half pint",
      });
      const pinta = await variant(tx, lunch, cana, "Pinta", {
        ca: "CLIENT-CA Pinta",
        en: "CLIENT-EN Pint",
      });
      await tx.insert(contentSuggestions).values({
        kind: "product",
        itemId: cana,
        language: "es",
        text: "CLIENT-ES Caña",
        expected: "{}",
      });

      const draft = await buildSuggestionJob(tx, context, new Set());
      expect(parsed(draft).items).toEqual([
        {
          ref: `product:${cana}`,
          kind: "product",
          family: `product:${cana}`,
          category: null,
          staffName: "STAFF Caña",
          existing: { ca: "CLIENT-CA Canya", en: "CLIENT-EN Half pint" },
          missing: [],
        },
        {
          ref: `variant:${pinta}`,
          kind: "variant",
          family: `product:${cana}`,
          category: null,
          staffName: "STAFF Pinta",
          existing: { ca: "CLIENT-CA Pinta", en: "CLIENT-EN Pint" },
          missing: ["es"],
        },
      ]);
      expect(draft!.sent).toEqual({ [`variant:${pinta}`]: ["es"] });
      expect(draft).toMatchObject({ included: 2, heads: 1, remaining: 0 });
    });
  });

  it("sends a member without its head when Cloud would refuse the head", async () => {
    await inVenue(async (tx, lunch) => {
      const cana = await product(tx, lunch, "Caña", all("Caña"));
      await rename(tx, cana, "S".repeat(TEXT_LIMIT + 1));
      const pinta = await variant(tx, lunch, cana, "Pinta", {
        ca: "CLIENT-CA Pinta",
        en: "CLIENT-EN Pint",
      });
      const draft = await buildSuggestionJob(tx, context, new Set());
      expect(parsed(draft).items.map((item) => [item.ref, item.family])).toEqual([
        [`variant:${pinta}`, `product:${cana}`],
      ]);
      expect(draft).toMatchObject({ included: 1, heads: 0 });
    });
  });
});

describe("the job's limits", () => {
  it("stops adding items at 1,000 and leaves the rest for the next job", async () => {
    await inVenue(async (tx, lunch) => {
      await manyProducts(tx, lunch, JOB_ITEM_LIMIT + 1, (index) => ({
        name: `STAFF Item ${index}`,
        customerName: { ca: `CLIENT-CA Item ${index}`, en: `CLIENT-EN Item ${index}` },
      }));
      const first = await buildSuggestionJob(tx, context, new Set());
      expect(first).toMatchObject({ included: JOB_ITEM_LIMIT, heads: 0, remaining: 1 });
      expect(Object.keys(first!.sent)).toHaveLength(JOB_ITEM_LIMIT);
      expect(parsed(first).items).toHaveLength(JOB_ITEM_LIMIT);
      const second = await buildSuggestionJob(tx, context, new Set(Object.keys(first!.sent)));
      expect(second).toMatchObject({ included: 1, heads: 0, remaining: 0 });
    });
  });

  it("counts a context head among the job's 1,000 items, and sends it again beside a member a later job carries", async () => {
    await inVenue(async (tx, lunch) => {
      const glass = await product(tx, lunch, "Copa", all("Copa"));
      await manyVariants(tx, lunch, glass, JOB_ITEM_LIMIT - 1, (index) => ({
        name: `STAFF Copa ${index}`,
        customerName: { ca: `CLIENT-CA Copa ${index}`, en: `CLIENT-EN Glass ${index}` },
      }));
      const bread = await product(tx, lunch, "Pa", { ca: "CLIENT-CA Pa", en: "CLIENT-EN Bread" });

      const first = await buildSuggestionJob(tx, context, new Set());
      expect(
        parsed(first)
          .items.slice(0, 2)
          .map((item) => [item.ref, item.missing]),
      ).toEqual([
        [`product:${bread}`, ["es"]],
        [`product:${glass}`, []],
      ]);
      expect(first).toMatchObject({ included: JOB_ITEM_LIMIT, heads: 1, remaining: 1 });
      expect(Object.keys(first!.sent)).toHaveLength(JOB_ITEM_LIMIT - 1);

      const second = await buildSuggestionJob(tx, context, new Set(Object.keys(first!.sent)));
      expect(parsed(second).items[0]!.ref).toBe(`product:${glass}`);
      expect(second).toMatchObject({ included: 2, heads: 1, remaining: 0 });
    });
  });

  it("does not split a context head from its member at the item limit", async () => {
    await inVenue(async (tx, lunch) => {
      await manyProducts(tx, lunch, JOB_ITEM_LIMIT - 1, (index) => ({
        name: `STAFF Item ${index}`,
        customerName: { ca: `CLIENT-CA Item ${index}`, en: `CLIENT-EN Item ${index}` },
      }));
      const glass = await product(tx, lunch, "Copa", all("Copa"));
      await variant(tx, lunch, glass, "Copa gran", {
        ca: "CLIENT-CA Copa gran",
        en: "CLIENT-EN Large glass",
      });
      const first = await buildSuggestionJob(tx, context, new Set());
      expect(first).toMatchObject({ included: JOB_ITEM_LIMIT - 1, heads: 0, remaining: 1 });
      expect(parsed(first).items.some((item) => item.ref === `product:${glass}`)).toBe(false);
    });
  });

  it("stops adding items at 1 MiB, counting every byte the body holds", async () => {
    await inVenue(async (tx, lunch) => {
      const wide = "é".repeat(TEXT_LIMIT);
      await manyProducts(tx, lunch, 800, (index) => ({
        name: `${"é".repeat(TEXT_LIMIT - 3)}${String(index).padStart(3, "0")}`,
        customerName: { es: wide, en: wide },
      }));
      const draft = (await buildSuggestionJob(tx, context, new Set()))!;
      const job = parsed(draft);
      expect(Buffer.byteLength(draft.body)).toBe(draft.bytes);
      expect(draft.bytes).toBeLessThanOrEqual(JOB_BYTE_LIMIT);
      expect(draft.included).toBeLessThan(800);
      expect(draft).toMatchObject({ heads: 0, remaining: 800 - draft.included });
      expect(Object.keys(draft.sent)).toHaveLength(draft.included);
      const [next] = await collectSuggestionItems(tx, context, new Set(Object.keys(draft.sent)));
      expect(draft.bytes + 1 + Buffer.byteLength(JSON.stringify(next))).toBeGreaterThan(
        JOB_BYTE_LIMIT,
      );
      for (const item of job.items) {
        expect(item.staffName.length).toBeLessThanOrEqual(TEXT_LIMIT);
        for (const text of Object.values(item.existing))
          expect(text.length).toBeLessThanOrEqual(TEXT_LIMIT);
      }
      expect(Buffer.byteLength(JSON.stringify(job.houseStyle))).toBeLessThanOrEqual(
        HOUSE_STYLE_BYTE_LIMIT,
      );
    });
  });

  it("builds a job with no item when the first item and its head pass 1 MiB, and a run start still sends it", async () => {
    await inVenue(async (tx, lunch) => {
      const { variantId } = await addOversizedFamily(tx, lunch.menuId);
      const items = await collectSuggestionItems(tx, context, new Set());
      expect(items[0]!.ref).toBe(`variant:${variantId}`);
      const draft = await buildSuggestionJob(tx, context, new Set());
      expect(draft).toMatchObject({ included: 0, heads: 0, remaining: items.length });
      expect(draft!.sent).toEqual({});
      expect(parsed(draft).items).toEqual([]);
      expect(Buffer.byteLength(draft!.body)).toBe(draft!.bytes);

      expect(await startSuggestionRun(tx, context)).toMatchObject({
        state: "sending",
        total: items.length,
      });
      const [job] = await tx.select().from(contentSuggestionJobs);
      expect(job).toMatchObject({ state: "submitting", runTotal: items.length });
      expect(job!.sent).toEqual({});
      expect((JSON.parse(job!.body!) as Job).items).toEqual([]);
    });
  });

  it("keeps the house style to a quarter of the job, in the order it was chosen", async () => {
    await inVenue(async (tx, lunch) => {
      const wide = "ü".repeat(TEXT_LIMIT);
      await manyProducts(tx, lunch, HOUSE_STYLE_LIMIT, (index) => ({
        name: `STAFF Item ${index}`,
        customerName: { ca: wide, es: wide, en: wide },
      }));
      await product(tx, lunch, "Pa", { ca: "CLIENT-CA Pa" });
      const full = await readHouseStyle(tx, THREE.languages);
      const job = parsed(await buildSuggestionJob(tx, context, new Set()));
      const kept = job.houseStyle.length;
      expect(full).toHaveLength(HOUSE_STYLE_LIMIT);
      expect(kept).toBeGreaterThan(0);
      expect(job.houseStyle).toEqual(full.slice(0, kept));
      expect(Buffer.byteLength(JSON.stringify(job.houseStyle))).toBeLessThanOrEqual(
        HOUSE_STYLE_BYTE_LIMIT,
      );
      expect(Buffer.byteLength(JSON.stringify(full.slice(0, kept + 1)))).toBeGreaterThan(
        HOUSE_STYLE_BYTE_LIMIT,
      );
      expect(job.items).toHaveLength(1);
    });
  });
});
