import {
  recomputeMadridHashes,
  stable,
  type CanonicalMadridSemantics,
} from "./madrid-semantics.js";

export interface MadridAddedProduct {
  /** The `<sha>.webp` file name that identifies the product. */
  image: string;
  name: string;
  customerName: Record<string, string>;
  kitchenName: string;
  vatClass: string;
  /** Whole cents, VAT included. */
  unitPrice: number;
  pricingUnit: string;
}
export interface MadridAddedCategory {
  /** The menu's name as captured, e.g. "Deli takeaway". */
  menu: string;
  name: string;
  /** The menu section's customer-facing names. */
  names: Record<string, string>;
  products: MadridAddedProduct[];
}

type Row = Record<string, unknown>;
const key = (table: string, ...parts: unknown[]) => `@${table}:${stable(parts)}`;
/** What ties an added row to a declaration; each declaration expects each slot exactly once. */
const SLOT: Record<string, (row: Row) => unknown> = {
  products: (row) => [row.id],
  categories: (row) => [row.id],
  category_details: (row) => [row.category_id],
  sections: (row) => [row.id],
  section_members: (row) => [row.section_id, row.product_id, row.child_section_id],
  menu_items: (row) => [row.id, row.menu_id, row.product_id],
  routing_cells: (row) => [row.category_id, row.product_id, row.zone_id],
  media_images: (row) => [row.id, row.filename],
  media_image_data: (row) => [row.image_id],
  media_image_edits: (row) => [row.image_id],
  menu_version_images: (row) => [row.version_id, row.filename],
};

interface Offer {
  productId?: unknown;
  [field: string]: unknown;
}
interface SectionMember {
  sectionId?: unknown;
  names?: unknown;
  members?: unknown[];
}
interface MenuDocument {
  offers?: Record<string, Offer>;
  root?: { members: SectionMember[] };
}

/** Add reviewed new products, each in a new category and menu section, to the original capture.
 * Each added row must fill one slot the declarations imply, and every slot must be filled once:
 * per category a `categories`, `category_details`, `sections` and `routing_cells` (no product or
 * zone) row and a `section_members` row placing the section in its menu's root; per product a
 * `products`, `menu_items` (its declared menu), `section_members` (its declared section),
 * `media_images`, `media_image_data` and `media_image_edits` row, and a `menu_version_images` row
 * for each published version of its menu. The declared facts (names, VAT class, price, pricing
 * unit, category, menu, image) are checked against the seeded rows, the section's names against
 * its seeded row, and all but the category against the published offer, whose placement must be
 * the declared section and whose variants and offered modifiers must be empty. Each declared
 * menu's published root must hold the declared section exactly once, with the declared names,
 * listing exactly the declared products once each; a declared product offered in any other menu,
 * or under another key in its own, is refused. Taken from `seeded` on trust: every other cell of
 * an added row (its sort positions and the section-member ids that carry them, colour, kitchen
 * station, media metadata); every other field of the new section's published entry beyond its
 * names and members; every other field of each new offer (description and colour among them); and
 * the order of the section within the root, of its products, and of the offers in the document.
 * Also refused: any existing row changed or removed; a published document that differs from the
 * capture's once the new section and offers are taken out. Returns the added row count per table,
 * which the declarations fix. */
export function madridWithAddedRows(
  original: CanonicalMadridSemantics,
  seeded: CanonicalMadridSemantics,
  categories: MadridAddedCategory[],
): { semantics: CanonicalMadridSemantics; added: Record<string, number> } {
  const result = structuredClone(original);
  const tables = new Set([...Object.keys(original.tables), ...Object.keys(seeded.tables)]);
  for (const name of tables)
    if (!original.tables[name] || !seeded.tables[name])
      throw new Error(`Madrid table added or removed: ${name}`);

  const versions = Object.entries(original.tables.menu_versions!.rows);
  const slots = new Map(Object.keys(SLOT).map((table) => [table, new Set<string>()]));
  const slot = (table: string, ...parts: unknown[]) => slots.get(table)!.add(stable(parts));
  const declaredMenuOf = new Map<string, string>();
  for (const category of categories) {
    const menu = key("catalogues", category.menu);
    const categoryKey = key("categories", category.name);
    const section = key("sections", menu, "section", category.name);
    const roots = Object.values(original.tables.sections!.rows).filter(
      (row) => row.role === "menu_root" && row.owner_menu_id === menu,
    );
    if (roots.length !== 1) throw new Error(`Madrid menu has no single root: ${category.menu}`);
    slot("categories", categoryKey);
    slot("category_details", categoryKey);
    slot("sections", section);
    slot("section_members", roots[0]!.id, null, section);
    slot("routing_cells", categoryKey, null, null);
    for (const product of category.products) {
      const productKey = key("products", product.image);
      const mediaImage = key("media_images", product.image);
      declaredMenuOf.set(productKey, menu);
      slot("products", productKey);
      slot("section_members", section, productKey, null);
      slot("menu_items", key("menu_items", menu, productKey), menu, productKey);
      slot("media_images", mediaImage, product.image);
      slot("media_image_data", mediaImage);
      slot("media_image_edits", mediaImage);
      for (const [versionKey, version] of versions)
        if (version.menu_id === menu) slot("menu_version_images", versionKey, product.image);
    }
  }

  for (const [name, table] of Object.entries(original.tables)) {
    if (name === "menu_versions") continue;
    for (const [rowKey, row] of Object.entries(table.rows)) {
      const after = seeded.tables[name]!.rows[rowKey];
      if (!after || stable(after) !== stable(row))
        throw new Error(`Madrid row changed or removed: ${name} ${rowKey}`);
    }
  }
  const filled = new Set<string>();
  for (const [name, table] of Object.entries(seeded.tables)) {
    const before = original.tables[name]!.rows;
    for (const [rowKey, row] of Object.entries(table.rows)) {
      if (Object.hasOwn(before, rowKey)) continue;
      const filling = SLOT[name] && stable(SLOT[name](row));
      if (filling === undefined || !slots.get(name)!.has(filling))
        throw new Error(`Madrid row not tied to a declared addition: ${name} ${rowKey}`);
      if (filled.has(`${name} ${filling}`))
        throw new Error(`Madrid declared addition duplicated: ${name} ${rowKey}`);
      filled.add(`${name} ${filling}`);
      result.tables[name]!.rows[rowKey] = structuredClone(row);
    }
  }

  const addedRow = (table: string, rowKey: string) =>
    Object.hasOwn(original.tables[table]!.rows, rowKey)
      ? undefined
      : seeded.tables[table]!.rows[rowKey];
  for (const category of categories) {
    const menu = key("catalogues", category.menu);
    const categoryKey = key("categories", category.name);
    if (addedRow("categories", categoryKey)?.name !== category.name)
      throw new Error(`Madrid declared category not added: ${category.name}`);
    const section = addedRow("sections", key("sections", menu, "section", category.name));
    if (!section) throw new Error(`Madrid declared section not added: ${category.name}`);
    if (stable(section.names) !== stable(category.names))
      throw new Error(`Madrid declared section names differ: ${category.name}`);
    for (const product of category.products) {
      const row = addedRow("products", key("products", product.image));
      if (!row) throw new Error(`Madrid declared product not added: ${product.image}`);
      const facts: [string, unknown, unknown][] = [
        ["name", product.name, row.name],
        ["customerName", product.customerName, row.customer_name],
        ["kitchenName", product.kitchenName, row.kitchen_name],
        ["vatClass", product.vatClass, row.vat_class],
        ["unitPrice", product.unitPrice, row.unit_price],
        ["pricingUnit", product.pricingUnit, row.pricing_unit],
        ["category", categoryKey, row.category_id],
        ["menu", menu, row.catalogue_id],
        ["image", product.image, row.image],
      ];
      for (const [field, want, inRow] of facts)
        if (stable(inRow) !== stable(want))
          throw new Error(`Madrid declared ${field} differs: ${product.image}`);
    }
  }
  for (const [table, expected] of slots)
    for (const filling of expected)
      if (!filled.has(`${table} ${filling}`))
        throw new Error(`Madrid declared addition missing: ${table} ${filling}`);

  for (const [versionKey, version] of versions) {
    const menuId = String(version.menu_id);
    const after = seeded.tables.menu_versions!.rows[versionKey];
    const document = after?.document as MenuDocument | undefined;
    if (!document) throw new Error(`Madrid row changed or removed: menu_versions ${versionKey}`);
    const stripped = structuredClone(document);
    const inMenu = categories.filter((category) => key("catalogues", category.menu) === menuId);
    for (const category of inMenu) {
      const section = key("sections", menuId, "section", category.name);
      const published = stripped.root?.members.filter((member) => member.sectionId === section);
      if (published?.length !== 1)
        throw new Error(`Madrid declared section not published once: ${category.name}`);
      if (stable(published[0]!.names) !== stable(category.names))
        throw new Error(`Madrid declared section names differ: ${category.name}`);
      const listed = (published[0]!.members ?? []).map((member) => stable(member)).sort();
      const declaredMembers = category.products
        .map((product) => {
          const productId = key("products", product.image);
          return stable({
            kind: "product",
            menuItemId: key("menu_items", menuId, productId),
            productId,
          });
        })
        .sort();
      if (stable(listed) !== stable(declaredMembers))
        throw new Error(`Madrid published section contents differ: ${category.name}`);
      stripped.root!.members = stripped.root!.members.filter(
        (member) => member.sectionId !== section,
      );
      for (const product of category.products) {
        const offerKey = key("menu_items", menuId, key("products", product.image));
        const offer = stripped.offers?.[offerKey];
        if (!offer) throw new Error(`Madrid declared product not published: ${product.image}`);
        delete stripped.offers![offerKey];
        const facts: [string, unknown, unknown][] = [
          ["name", product.name, offer.name],
          ["customerName", product.customerName, offer.customerName],
          ["kitchenName", product.kitchenName, offer.kitchenName],
          ["vatClass", product.vatClass, offer.vatClass],
          ["unitPrice", (product.unitPrice / 100).toFixed(2), offer.unitPrice],
          ["pricingUnit", product.pricingUnit, offer.pricingUnit],
          ["menu", menuId, offer.menuId],
          ["section", [[section]], offer.placements],
          ["image", product.image, offer.image],
          ["variants", [], offer.variants],
          ["offeredModifiers", [], offer.offeredModifiers],
        ];
        for (const [field, want, inOffer] of facts)
          if (stable(inOffer) !== stable(want))
            throw new Error(`Madrid declared ${field} differs: ${product.image}`);
      }
    }
    for (const offer of Object.values(stripped.offers ?? {}))
      if (declaredMenuOf.has(String(offer.productId)))
        throw new Error(
          `Madrid declared product offered outside its declared menu item: ${String(offer.productId)} in ${versionKey}`,
        );
    if (inMenu.length === 0) continue;
    if (stable(stripped) !== stable(version.document))
      throw new Error(`Madrid published document changed beyond the addition: ${versionKey}`);
    result.tables.menu_versions!.rows[versionKey]!.document = structuredClone(document);
  }

  recomputeMadridHashes(result);
  const resultVersions = result.tables.menu_versions!.rows;
  const seededVersions = seeded.tables.menu_versions!.rows;
  if (
    Object.keys(resultVersions).length !== Object.keys(seededVersions).length ||
    Object.entries(resultVersions).some(([k, row]) => stable(row) !== stable(seededVersions[k]))
  )
    throw new Error("Madrid row changed or removed: menu_versions");
  const added = Object.fromEntries(
    [...slots].filter(([, expected]) => expected.size > 0).map(([t, e]) => [t, e.size]),
  );
  return { semantics: result, added };
}
