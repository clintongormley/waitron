import {
  assertMadridFacts,
  assertMadridVersionsMatch,
  assertSameMadridTables,
  stable,
  type CanonicalMadridSemantics,
} from "./madrid-semantics.js";

export interface MadridChangedCell {
  table: string;
  row: string;
  column: string;
  from: unknown;
  to: unknown;
}
export interface MadridSharedProduct {
  /** The `<sha>.webp` file name that identifies the product. */
  image: string;
  name: string;
  customerName: Record<string, string>;
  kitchenName: string;
  /** The captured category's name. */
  category: string;
  courseId: string | null;
  vatClass: string;
  /** `null`: none of its own, so its offers take away at `vatClass`. */
  takeawayVatClass: string | null;
  /** Whole cents, VAT included. */
  unitPrice: number;
  pricingUnit: string;
}
export interface MadridSharedOffers {
  /** Existing cells that change; every other cell of an existing row must stay as captured. */
  changed: MadridChangedCell[];
  /** New products, placed in existing categories. */
  products: MadridSharedProduct[];
  /** Every added row, by table, as the cells `SLOT` names for it; no other row may be added. */
  added: Partial<Record<keyof typeof SLOT, unknown[][]>>;
  /** Captured rows whose canonical keys must disappear. */
  removed?: Partial<Record<keyof typeof SLOT, string[]>>;
  /** Set-menu copies and root members by published full-menu version. */
  setMenus?: Record<string, string[]>;
  /** Published offer fields that change on existing offers, keyed by menu item. */
  changedOffers: { menuItem: string; field: string; from: unknown; to: unknown }[];
}

type Row = Record<string, unknown>;
/** The cells that identify an added row, whatever its canonical key. */
const SLOT = {
  products: (row: Row) => [row.id],
  catalogues: (row: Row) => [row.id],
  menu_details: (row: Row) => [row.menu_id],
  set_menu_lines: (row: Row) => [row.id],
  set_menu_line_courses: (row: Row) => [row.line_id, row.course_id],
  set_menu_variant_exclusions: (row: Row) => [row.menu_item_id, row.product_id, row.variant_id],
  set_menu_dish_courses: (row: Row) => [row.menu_item_id, row.course_id],
  kitchen_courses: (row: Row) => [row.id, row.display_order],
  department_courses: (row: Row) => [
    row.department_id,
    row.course_id,
    row.held_until_fired,
    row.reminder_minutes,
  ],
  sections: (row: Row) => [row.id],
  section_members: (row: Row) => [row.section_id, row.product_id, row.child_section_id],
  menu_items: (row: Row) => [row.menu_id, row.product_id],
  routing_cells: (row: Row) => [row.category_id, row.product_id, row.zone_id, row.station_id],
  media_images: (row: Row) => [row.filename],
  media_blobs: (row: Row) => [row.hash],
  menu_version_images: (row: Row) => [row.version_id, row.filename],
};
interface Member {
  kind?: string;
  menuId?: string;
  sectionId?: unknown;
  menuItemId?: unknown;
  members?: Member[];
}
interface MenuDocument {
  offers?: Record<string, Row>;
  root?: { members: Member[] };
  includedMenuHashes?: Record<string, unknown>;
  setMenus?: Record<string, unknown>;
}

/** Add products that join existing categories and are offered on more than one menu, and the
 * declared cell changes, to the capture. Refused: an existing row changed beyond the declared
 * cells, or a removal outside the declaration; an added row not declared, or a declared one missing; a declared product
 * whose names, classes, price, pricing unit, category or image differ from its seeded row or from
 * any of its published offers, or whose seeded course differs; and a published document that, with the added sections, members
 * and offers taken out, the declared offer changes undone and its included-menu hashes set aside,
 * differs from the capture after stripping declared removals. Published set-menu copies and their
 * root members must match the declared ids. Taken from `seeded` on trust: every other cell of an added row, and
 * where the added members and sections sit. Returns added and removed row counts. */
export function madridWithSharedOffers(
  original: CanonicalMadridSemantics,
  seeded: CanonicalMadridSemantics,
  declared: MadridSharedOffers,
): {
  semantics: CanonicalMadridSemantics;
  added: Record<string, number>;
  removed: Record<string, number>;
} {
  const result = structuredClone(original);
  assertSameMadridTables(original, seeded);
  const removed: Record<string, number> = {};
  const removals = new Map<string, Set<string>>();
  for (const [name, keys] of Object.entries(declared.removed ?? {})) {
    const rows = new Set(keys);
    for (const key of rows) {
      if (
        original.tables[name]?.rows[key] === undefined ||
        seeded.tables[name]?.rows[key] !== undefined
      )
        throw new Error(`Madrid declared removal differs: ${name} ${key}`);
      delete result.tables[name]!.rows[key];
    }
    if (rows.size > 0) removed[name] = rows.size;
    removals.set(name, rows);
  }

  const changedCells = new Map(
    declared.changed.map((cell) => [stable([cell.table, cell.row, cell.column]), cell]),
  );
  const applied = new Set<string>();
  for (const [name, table] of Object.entries(original.tables)) {
    if (name === "menu_versions") continue;
    for (const [rowKey, row] of Object.entries(table.rows)) {
      if (removals.get(name)?.has(rowKey)) continue;
      const after = seeded.tables[name]!.rows[rowKey];
      if (!after) throw new Error(`Madrid row removed: ${name} ${rowKey}`);
      for (const column of new Set([...Object.keys(row), ...Object.keys(after)])) {
        const cell = changedCells.get(stable([name, rowKey, column]));
        if (cell === undefined) {
          if (stable(after[column]) !== stable(row[column]))
            throw new Error(`Madrid row changed: ${name} ${rowKey} ${column}`);
          continue;
        }
        if (stable(row[column]) !== stable(cell.from) || stable(after[column]) !== stable(cell.to))
          throw new Error(`Madrid declared change differs: ${name} ${rowKey} ${column}`);
        result.tables[name]!.rows[rowKey]![column] = structuredClone(after[column]);
        applied.add(stable([name, rowKey, column]));
      }
    }
  }
  for (const key of changedCells.keys())
    if (!applied.has(key)) throw new Error(`Madrid declared change missing: ${key}`);

  const added: Record<string, number> = {};
  const freshKeys: Record<string, string[]> = {};
  for (const [name, table] of Object.entries(seeded.tables)) {
    if (name === "menu_versions") continue;
    const before = original.tables[name]!.rows;
    const fresh = Object.keys(table.rows).filter((rowKey) => !Object.hasOwn(before, rowKey));
    const slot = (SLOT as Record<string, ((row: Row) => unknown[]) | undefined>)[name];
    const want = ((declared.added as Record<string, unknown[][]>)[name] ?? []).map(stable).sort();
    const got = fresh.map((rowKey) => (slot ? stable(slot(table.rows[rowKey]!)) : rowKey)).sort();
    if (stable(got) !== stable(want))
      throw new Error(`Madrid added rows differ: ${name}: ${stable(got)} vs ${stable(want)}`);
    for (const rowKey of fresh)
      result.tables[name]!.rows[rowKey] = structuredClone(table.rows[rowKey]!);
    freshKeys[name] = fresh;
    if (fresh.length > 0) added[name] = fresh.length;
  }

  const productKey = (image: string) => `@products:${stable([image])}`;
  const categoryKey = (name: string) => `@categories:${stable([name])}`;
  for (const product of declared.products) {
    const row = result.tables.products!.rows[productKey(product.image)];
    if (!row || Object.hasOwn(original.tables.products!.rows, productKey(product.image)))
      throw new Error(`Madrid declared product not added: ${product.image}`);
    const facts: [string, unknown, unknown][] = [
      ["name", product.name, row.name],
      ["customerName", product.customerName, row.customer_name],
      ["kitchenName", product.kitchenName, row.kitchen_name],
      ["category", categoryKey(product.category), row.category_id],
      ["course", product.courseId, row.course_id],
      ["vatClass", product.vatClass, row.vat_class],
      ["takeawayVatClass", product.takeawayVatClass, row.takeaway_vat_class],
      ["unitPrice", product.unitPrice, row.unit_price],
      ["pricingUnit", product.pricingUnit, row.pricing_unit],
      ["image", product.image, row.image],
    ];
    assertMadridFacts(facts, product.image);
  }

  const addedItems = new Set(freshKeys.menu_items ?? []);
  const addedSections = new Set(freshKeys.sections ?? []);
  const changedOffers = new Set<number>();
  const declaredProducts = new Map(declared.products.map((p) => [productKey(p.image), p]));
  const strip = (
    members: Member[],
    items: ReadonlySet<string>,
    sections: ReadonlySet<string>,
  ): Member[] =>
    members
      .filter(
        (member) =>
          !items.has(String(member.menuItemId)) && !sections.has(String(member.sectionId)),
      )
      .map((member) =>
        member.members === undefined
          ? member
          : { ...member, members: strip(member.members, items, sections) },
      );
  const removedItems = removals.get("menu_items") ?? new Set<string>();
  const removedSections = removals.get("sections") ?? new Set<string>();
  const setMenus = new Map(Object.entries(declared.setMenus ?? {}));
  for (const [versionKey, version] of Object.entries(original.tables.menu_versions!.rows)) {
    const document = seeded.tables.menu_versions!.rows[versionKey]?.document as
      MenuDocument | undefined;
    if (!document) throw new Error(`Madrid row removed: menu_versions ${versionKey}`);
    const stripped = structuredClone(document);
    for (const [offerKey, offer] of Object.entries(stripped.offers ?? {})) {
      if (!addedItems.has(offerKey)) continue;
      const product = declaredProducts.get(String(offer.productId));
      if (product !== undefined) {
        const facts: [string, unknown, unknown][] = [
          ["name", product.name, offer.name],
          ["customerName", product.customerName, offer.customerName],
          ["kitchenName", product.kitchenName, offer.kitchenName],
          ["vatClass", product.vatClass, offer.vatClass],
          [
            "takeawayVatClass",
            product.takeawayVatClass ?? product.vatClass,
            offer.takeawayVatClass,
          ],
          ["unitPrice", (product.unitPrice / 100).toFixed(2), offer.unitPrice],
          ["pricingUnit", product.pricingUnit, offer.pricingUnit],
          ["image", product.image, offer.image],
        ];
        assertMadridFacts(facts, `${product.image} in ${versionKey}`);
      }
      delete stripped.offers![offerKey];
    }
    for (const [index, change] of declared.changedOffers.entries()) {
      const offer = stripped.offers?.[change.menuItem];
      if (offer === undefined) continue;
      changedOffers.add(index);
      if (stable(offer[change.field]) !== stable(change.to))
        throw new Error(`Madrid declared offer change differs: ${change.menuItem} ${change.field}`);
      offer[change.field] = structuredClone(change.from);
    }
    const expectedCopies = [...(setMenus.get(versionKey) ?? [])].sort();
    if (stable(Object.keys(stripped.setMenus ?? {}).sort()) !== stable(expectedCopies))
      throw new Error(`Madrid set-menu copies differ: ${versionKey}`);
    const setMembers = (stripped.root?.members ?? []).filter(({ kind }) => kind === "set_menu");
    if (stable(setMembers.map(({ menuId }) => menuId).sort()) !== stable(expectedCopies))
      throw new Error(`Madrid set-menu members differ: ${versionKey}`);
    if (expectedCopies.length > 0) delete stripped.setMenus;
    setMenus.delete(versionKey);
    if (stripped.root)
      stripped.root.members = strip(
        stripped.root.members.filter(({ kind }) => kind !== "set_menu"),
        addedItems,
        addedSections,
      );
    const captured = structuredClone(version.document as MenuDocument);
    for (const id of removedItems) delete captured.offers?.[id];
    if (captured.root)
      captured.root.members = strip(captured.root.members, removedItems, removedSections);
    if (stripped.includedMenuHashes && captured.includedMenuHashes)
      stripped.includedMenuHashes = structuredClone(captured.includedMenuHashes);
    if (stable(stripped) !== stable(captured))
      throw new Error(`Madrid published document changed beyond the declaration: ${versionKey}`);
    result.tables.menu_versions!.rows[versionKey]!.document = structuredClone(document);
  }

  for (const [index, change] of declared.changedOffers.entries())
    if (!changedOffers.has(index))
      throw new Error(`Madrid declared offer change not published: ${change.menuItem}`);

  if (setMenus.size > 0)
    throw new Error(`Madrid declared set-menu version missing: ${[...setMenus.keys()].join(", ")}`);
  assertMadridVersionsMatch(result, seeded);
  return { semantics: result, added, removed };
}
