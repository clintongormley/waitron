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

interface Declared {
  products: Set<string>;
  categories: Set<string>;
  sections: Set<string>;
  images: Set<string>;
  mediaImages: Set<string>;
}
const key = (table: string, ...parts: unknown[]) => `@${table}:${stable(parts)}`;
const TIED: Record<string, (row: Record<string, unknown>, declared: Declared) => boolean> = {
  products: (row, d) => d.products.has(String(row.id)),
  categories: (row, d) => d.categories.has(String(row.id)),
  category_details: (row, d) => d.categories.has(String(row.category_id)),
  sections: (row, d) => d.sections.has(String(row.id)),
  section_members: (row, d) =>
    d.products.has(String(row.product_id)) || d.sections.has(String(row.child_section_id)),
  menu_items: (row, d) => d.products.has(String(row.product_id)),
  routing_cells: (row, d) =>
    d.categories.has(String(row.category_id)) || d.products.has(String(row.product_id)),
  media_images: (row, d) => d.images.has(String(row.filename)),
  media_image_data: (row, d) => d.mediaImages.has(String(row.image_id)),
  media_image_edits: (row, d) => d.mediaImages.has(String(row.image_id)),
  menu_version_images: (row, d) => d.images.has(String(row.filename)),
};

interface Offer {
  productId?: unknown;
  [field: string]: unknown;
}
interface MenuDocument {
  offers: Record<string, Offer>;
  root: { members: { sectionId?: unknown }[] };
}

/** Add reviewed new products, each in a new category and menu section, to the original capture.
 * The declared facts (names, VAT class, price, pricing unit, category, menu, image) are checked
 * against both the seeded rows and the published menu document. Every other cell of an added row —
 * its ids, sort positions, colour, kitchen station, media metadata — is taken from `seeded` on
 * trust, as is the order of the new section and offers within the document. Refused: a declared
 * product, category or section the seed did not add; an added row outside the listed tables or not
 * tied to a declaration; any existing row changed or removed; a published document that differs
 * from the capture's once the new section and offers are taken out. Returns the added row count
 * per table. */
export function madridWithAddedRows(
  original: CanonicalMadridSemantics,
  seeded: CanonicalMadridSemantics,
  categories: MadridAddedCategory[],
): { semantics: CanonicalMadridSemantics; added: Record<string, number> } {
  const result = structuredClone(original);
  const declared: Declared = {
    products: new Set(),
    categories: new Set(),
    sections: new Set(),
    images: new Set(),
    mediaImages: new Set(),
  };
  const menus = new Set<string>();
  for (const category of categories) {
    const menu = key("catalogues", category.menu);
    menus.add(menu);
    declared.categories.add(key("categories", category.name));
    declared.sections.add(key("sections", menu, "section", category.name));
    for (const product of category.products) {
      declared.products.add(key("products", product.image));
      declared.images.add(product.image);
      declared.mediaImages.add(key("media_images", product.image));
    }
  }
  const tables = new Set([...Object.keys(original.tables), ...Object.keys(seeded.tables)]);
  for (const name of tables)
    if (!original.tables[name] || !seeded.tables[name])
      throw new Error(`Madrid table added or removed: ${name}`);

  for (const [name, table] of Object.entries(original.tables)) {
    if (name === "menu_versions") continue;
    for (const [rowKey, row] of Object.entries(table.rows)) {
      const after = seeded.tables[name]!.rows[rowKey];
      if (!after || stable(after) !== stable(row))
        throw new Error(`Madrid row changed or removed: ${name} ${rowKey}`);
    }
  }
  const added: Record<string, number> = {};
  for (const [name, table] of Object.entries(seeded.tables)) {
    const before = original.tables[name]!.rows;
    for (const [rowKey, row] of Object.entries(table.rows)) {
      if (Object.hasOwn(before, rowKey)) continue;
      if (!TIED[name]?.(row, declared))
        throw new Error(`Madrid row not tied to a declared addition: ${name} ${rowKey}`);
      result.tables[name]!.rows[rowKey] = structuredClone(row);
      added[name] = (added[name] ?? 0) + 1;
    }
  }

  const addedRow = (table: string, rowKey: string) =>
    Object.hasOwn(original.tables[table]!.rows, rowKey)
      ? undefined
      : seeded.tables[table]!.rows[rowKey];
  const offers = new Map<string, Offer>();
  for (const [versionKey, version] of Object.entries(original.tables.menu_versions!.rows)) {
    if (!menus.has(String(version.menu_id))) continue;
    const after = seeded.tables.menu_versions!.rows[versionKey];
    const document = after?.document as MenuDocument | undefined;
    if (!document) throw new Error(`Madrid row changed or removed: menu_versions ${versionKey}`);
    const stripped = structuredClone(document);
    for (const [offerKey, offer] of Object.entries(stripped.offers))
      if (declared.products.has(String(offer.productId))) {
        offers.set(String(offer.productId), offer);
        delete stripped.offers[offerKey];
      }
    stripped.root.members = stripped.root.members.filter(
      (member) => !declared.sections.has(String(member.sectionId)),
    );
    if (stable(stripped) !== stable(version.document))
      throw new Error(`Madrid published document changed beyond the addition: ${versionKey}`);
    result.tables.menu_versions!.rows[versionKey]!.document = structuredClone(document);
  }

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
      const offer = offers.get(key("products", product.image));
      if (!row || !offer) throw new Error(`Madrid declared product not added: ${product.image}`);
      const facts: [string, unknown, unknown, unknown, unknown?][] = [
        ["name", product.name, row.name, offer.name],
        ["customerName", product.customerName, row.customer_name, offer.customerName],
        ["kitchenName", product.kitchenName, row.kitchen_name, offer.kitchenName],
        ["vatClass", product.vatClass, row.vat_class, offer.vatClass],
        [
          "unitPrice",
          product.unitPrice,
          row.unit_price,
          offer.unitPrice,
          (product.unitPrice / 100).toFixed(2),
        ],
        ["pricingUnit", product.pricingUnit, row.pricing_unit, offer.pricingUnit],
        ["category", categoryKey, row.category_id, categoryKey],
        ["menu", menu, row.catalogue_id, menu],
        ["image", product.image, row.image, offer.image],
      ];
      for (const [field, want, inRow, inOffer, wantInOffer = want] of facts)
        if (stable(inRow) !== stable(want) || stable(inOffer) !== stable(wantInOffer))
          throw new Error(`Madrid declared ${field} differs: ${product.image}`);
    }
  }

  recomputeMadridHashes(result);
  const versions = result.tables.menu_versions!.rows;
  const seededVersions = seeded.tables.menu_versions!.rows;
  if (
    Object.keys(versions).length !== Object.keys(seededVersions).length ||
    Object.entries(versions).some(([k, row]) => stable(row) !== stable(seededVersions[k]))
  )
    throw new Error("Madrid row changed or removed: menu_versions");
  return { semantics: result, added };
}
