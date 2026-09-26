import { createHash } from "node:crypto";
import { and, eq, inArray, type SQL } from "drizzle-orm";
import { catalogues, categories, products, type Transaction } from "@waitron/db";
import { AppError, FALLBACK_LOCALE, resolveContentText } from "@waitron/shared";
import { batches } from "./batches.js";
import { readContentLanguages } from "./content-languages.js";
import { listMenuOffers } from "./operations.js";
import { menuItemExtraItems } from "./schema/extras.js";
import { menuDetails } from "./schema/menu.js";
import { optionLabels } from "./schema/options.js";
import { sections } from "./schema/sections.js";
import { loadSectionGraph, type SectionGraph } from "./section-graph.js";
import { effectiveProductColumns, parentJoin, parentProducts } from "./variant-fallback.js";
import type { MenuOffer } from "./menu-types.js";
import type { VatClass } from "./pricing.js";
import type { MemberRef } from "./section-types.js";
import type {
  DocumentLayout,
  DocumentMember,
  DocumentTile,
  FrozenOffer,
  FrozenOfferedModifier,
  LiveOffer,
  LiveOfferedModifier,
  MenuChange,
  MenuChangeSource,
  MenuDocument,
  ProductChangeField,
  SectionChangeField,
} from "./menu-document-types.js";
import "./errors.js";

export type * from "./menu-document-types.js";

export const MENU_DOCUMENT_FORMAT = 1;

export interface OmittedShortcut {
  layoutId: string;
  ref: MemberRef;
}

interface BuiltMenu {
  document: MenuDocument;
  omittedShortcuts: OmittedShortcut[];
  rootSectionId: string;
}

/** Several menus' documents built together, and what they were built from. */
export interface BuiltMenus {
  graph: SectionGraph;
  menus: Map<string, BuiltMenu>;
  /** Every section's internal name, by id. */
  sectionNames: Map<string, string>;
}

interface SectionRow {
  id: string;
  internalName: string;
  names: Record<string, string>;
  image: string | null;
  color: string | null;
  role: string;
  ownerMenuId: string | null;
}

function groupBy<T>(values: readonly T[], keyOf: (value: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    if (key === null) continue;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [value]);
    else group.push(value);
  }
  return groups;
}

/**
 * The named menus' documents, or every menu's when `menuIds` is left out, from one graph load and
 * one offers read however many menus. A menu with no details row is left out. `graph` is one the
 * caller has already loaded in this transaction.
 */
export async function buildMenuDocuments(
  tx: Transaction,
  menuIds?: readonly string[],
  graph?: SectionGraph,
): Promise<BuiltMenus> {
  const readDetails = (where?: SQL) =>
    tx
      .select({
        menuId: menuDetails.menuId,
        rootSectionId: menuDetails.rootSectionId,
        defaultHomeLayoutId: menuDetails.defaultHomeLayoutId,
        menuName: catalogues.name,
      })
      .from(menuDetails)
      .innerJoin(catalogues, eq(catalogues.id, menuDetails.menuId))
      .where(where)
      .orderBy(catalogues.createdAt, catalogues.id);
  const details = [];
  if (menuIds === undefined) details.push(...(await readDetails()));
  else
    for (const batch of batches(menuIds))
      details.push(...(await readDetails(inArray(menuDetails.menuId, batch))));
  const loaded = graph ?? (await loadSectionGraph(tx));
  const menus = new Map<string, BuiltMenu>();
  const sectionNames = new Map<string, string>();
  if (details.length === 0) return { graph: loaded, menus, sectionNames };
  const offers = await listMenuOffers(
    tx,
    details.map((row) => row.menuId),
    { includeUnavailable: true, includeEveryModifierItem: true, graph: loaded },
  );
  const dishFacts = await readDishFacts(tx, [...new Set(offers.map((offer) => offer.productId))]);
  const extraImages = await readEffectiveImages(tx, [
    ...new Set(
      offers.flatMap((offer) =>
        offer.offeredModifiers.flatMap((entry) =>
          entry.kind === "extras" ? entry.items.map((item) => item.productId) : [],
        ),
      ),
    ),
  ]);
  const sectionRows: SectionRow[] = await tx
    .select({
      id: sections.id,
      internalName: sections.internalName,
      names: sections.names,
      image: sections.image,
      color: sections.color,
      role: sections.role,
      ownerMenuId: sections.ownerMenuId,
    })
    .from(sections)
    .orderBy(sections.internalName, sections.id);
  const sectionById = new Map(sectionRows.map((row) => [row.id, row]));
  for (const row of sectionRows) sectionNames.set(row.id, row.internalName);
  const offersByMenu = groupBy(offers, (offer) => offer.menuId);
  const layoutsByMenu = groupBy(sectionRows, (section) =>
    section.role === "home_layout" ? section.ownerMenuId : null,
  );
  for (const row of details) {
    const onMenu = new Map(
      (offersByMenu.get(row.menuId) ?? []).map((offer) => [
        offer.productId,
        freezeOffer(offer, dishFacts.get(offer.productId)!, extraImages),
      ]),
    );
    const reachedSections = new Set<string>();
    const listOf = (sectionId: string, path: readonly string[]): DocumentMember[] =>
      loaded.children(sectionId).flatMap(({ ref }): DocumentMember[] => {
        if (ref.kind === "product") {
          const offer = onMenu.get(ref.productId);
          return offer === undefined
            ? []
            : [{ kind: "product", menuItemId: offer.id, productId: ref.productId }];
        }
        if (path.includes(ref.sectionId)) return [];
        reachedSections.add(ref.sectionId);
        const section = sectionById.get(ref.sectionId)!;
        return [
          {
            kind: "section",
            sectionId: section.id,
            internalName: section.internalName,
            names: section.names,
            image: section.image,
            color: section.color,
            members: listOf(section.id, [...path, section.id]),
          },
        ];
      });
    const root = { members: listOf(row.rootSectionId, [row.rootSectionId]) };
    const omittedShortcuts: OmittedShortcut[] = [];
    const layouts = layoutsByMenu.get(row.menuId) ?? [];
    const homeLayouts = [
      ...layouts.filter((layout) => layout.id === row.defaultHomeLayoutId),
      ...layouts.filter((layout) => layout.id !== row.defaultHomeLayoutId),
    ].map((layout): DocumentLayout => {
      const tiles: DocumentTile[] = [];
      for (const { ref } of loaded.children(layout.id)) {
        const onThisMenu =
          ref.kind === "product" ? onMenu.has(ref.productId) : reachedSections.has(ref.sectionId);
        if (onThisMenu) tiles.push(ref);
        else omittedShortcuts.push({ layoutId: layout.id, ref });
      }
      return { id: layout.id, name: layout.internalName, tiles };
    });
    menus.set(row.menuId, {
      rootSectionId: row.rootSectionId,
      omittedShortcuts,
      document: {
        format: MENU_DOCUMENT_FORMAT,
        menuId: row.menuId,
        menuName: row.menuName,
        root,
        offers: Object.fromEntries([...onMenu.values()].map((offer) => [offer.id, offer])),
        homeLayouts,
        defaultHomeLayoutId: row.defaultHomeLayoutId,
      },
    });
  }
  return { graph: loaded, menus, sectionNames };
}

/** The document the menu's working state would publish, and the shortcuts it leaves out (D13). */
export async function buildMenuDocument(
  tx: Transaction,
  menuId: string,
): Promise<{ document: MenuDocument; omittedShortcuts: OmittedShortcut[] }> {
  const built = (await buildMenuDocuments(tx, [menuId])).menus.get(menuId);
  if (built === undefined) throw new AppError("catalogue.not_found", { catalogueId: menuId });
  return { document: built.document, omittedShortcuts: built.omittedShortcuts };
}

/** The dish's own photo and description, which `MenuOffer` does not carry. */
async function readDishFacts(
  tx: Transaction,
  productIds: readonly string[],
): Promise<Map<string, { image: string | null; description: Record<string, string> | null }>> {
  const facts = new Map<
    string,
    { image: string | null; description: Record<string, string> | null }
  >();
  for (const batch of batches(productIds))
    for (const row of await tx
      .select({ id: products.id, image: products.image, description: products.description })
      .from(products)
      .where(inArray(products.id, batch)))
      facts.set(row.id, { image: row.image, description: row.description });
  return facts;
}

/** Each product's photo, a variant's borrowed from its parent when it has none of its own. */
async function readEffectiveImages(
  tx: Transaction,
  productIds: readonly string[],
): Promise<Map<string, string | null>> {
  const images = new Map<string, string | null>();
  for (const batch of batches(productIds))
    for (const row of await tx
      .select({ id: products.id, image: effectiveProductColumns.image })
      .from(products)
      .leftJoin(parentProducts, parentJoin)
      .where(inArray(products.id, batch)))
      images.set(row.id, row.image);
  return images;
}

/** A copy of `value` without `keys`. */
function without<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Omit<T, K> {
  const dropped = new Set<PropertyKey>(keys);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !dropped.has(key))) as Omit<
    T,
    K
  >;
}

function freezeOffer(
  offer: MenuOffer,
  facts: { image: string | null; description: Record<string, string> | null },
  extraImages: ReadonlyMap<string, string | null>,
): FrozenOffer {
  return {
    ...without(offer, ["vatClass", "courseId", "category", "offeredModifiers", "variants"]),
    image: facts.image,
    description: facts.description,
    variants: offer.variants.map((variant) =>
      without(variant, ["available", "vatClass", "courseId", "category"]),
    ),
    offeredModifiers: offer.offeredModifiers.map((entry): FrozenOfferedModifier =>
      entry.kind === "options"
        ? { ...entry, labels: entry.labels.map((label) => without(label, ["available"])) }
        : {
            ...entry,
            items: entry.items.map((item) => ({
              ...without(item, ["vatClass"]),
              image: extraImages.get(item.productId)!,
            })),
          },
    ),
  };
}

/** JSON with every object's keys sorted, all the way down; arrays keep their order. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

/** SHA-256, in hex, of the document's canonical JSON. */
export function menuDocumentHash(document: MenuDocument): string {
  return createHash("sha256").update(canonicalJson(document)).digest("hex");
}

/** Every photo the document names, each once, sorted. */
export function documentImages(document: MenuDocument): string[] {
  const images = new Set<string>();
  const add = (image: string | null): void => {
    if (image !== null) images.add(image);
  };
  const walk = (members: readonly DocumentMember[]): void => {
    for (const member of members)
      if (member.kind === "section") {
        add(member.image);
        walk(member.members);
      }
  };
  walk(document.root.members);
  for (const offer of Object.values(document.offers)) {
    add(offer.image);
    for (const variant of offer.variants) add(variant.image);
    for (const entry of offer.offeredModifiers)
      if (entry.kind === "extras") for (const item of entry.items) add(item.image);
  }
  return [...images].sort();
}

/** The document's offers in menu order: depth first, each product at its first place. */
function offersInOrder(document: MenuDocument): FrozenOffer[] {
  const seen = new Set<string>();
  const ordered: FrozenOffer[] = [];
  const walk = (members: readonly DocumentMember[]): void => {
    for (const member of members)
      if (member.kind === "section") walk(member.members);
      else if (!seen.has(member.menuItemId)) {
        seen.add(member.menuItemId);
        ordered.push(document.offers[member.menuItemId]!);
      }
  };
  walk(document.root.members);
  return ordered;
}

interface LiveProductRow {
  active: boolean;
  available: boolean;
  vatClass: VatClass;
  courseId: string | null;
  category: Record<string, string> | null;
}

/**
 * The documents' offers, per menu and in menu order, with the live fields put back from the current
 * rows: availability, and the VAT class, course and reporting category that are not menu content.
 *
 * An item whose product row no longer exists is left out, as is an offer whose product is gone.
 */
export async function applyLiveFields(
  tx: Transaction,
  documents: readonly MenuDocument[],
): Promise<Map<string, LiveOffer[]>> {
  const live = new Map<string, LiveOffer[]>();
  if (documents.length === 0) return live;
  const productIds = new Set<string>();
  const labelIds = new Set<string>();
  const menuItemIds: string[] = [];
  for (const document of documents)
    for (const offer of Object.values(document.offers)) {
      menuItemIds.push(offer.id);
      productIds.add(offer.productId);
      for (const variant of offer.variants) productIds.add(variant.id);
      for (const entry of offer.offeredModifiers)
        if (entry.kind === "extras") for (const item of entry.items) productIds.add(item.productId);
        else for (const label of entry.labels) labelIds.add(label.id);
    }

  const rows = new Map<string, LiveProductRow>();
  for (const batch of batches([...productIds]))
    for (const row of await tx
      .select({
        id: products.id,
        active: products.active,
        available: products.available,
        vatClass: effectiveProductColumns.vatClass,
        courseId: effectiveProductColumns.courseId,
        category: categories.name,
      })
      .from(products)
      .leftJoin(parentProducts, parentJoin)
      .leftJoin(categories, eq(categories.id, effectiveProductColumns.categoryId))
      .where(inArray(products.id, batch)))
      rows.set(row.id, { ...row, vatClass: row.vatClass as VatClass });
  const labels = new Map<string, boolean>();
  for (const batch of batches([...labelIds]))
    for (const row of await tx
      .select({ id: optionLabels.id, available: optionLabels.available })
      .from(optionLabels)
      .where(inArray(optionLabels.id, batch)))
      labels.set(row.id, row.available);
  const withdrawn = new Set<string>();
  const itemKey = (menuItemId: string, listId: string, productId: string) =>
    `${menuItemId}\u0000${listId}\u0000${productId}`;
  for (const batch of batches(menuItemIds))
    for (const row of await tx
      .select({
        menuItemId: menuItemExtraItems.menuItemId,
        listId: menuItemExtraItems.listId,
        productId: menuItemExtraItems.productId,
      })
      .from(menuItemExtraItems)
      .where(
        and(inArray(menuItemExtraItems.menuItemId, batch), eq(menuItemExtraItems.available, false)),
      ))
      withdrawn.add(itemKey(row.menuItemId, row.listId, row.productId));
  const { defaultLanguage } = await readContentLanguages(tx, FALLBACK_LOCALE);
  const categoryOf = (row: LiveProductRow) =>
    row.category === null
      ? null
      : resolveContentText(row.category, defaultLanguage, defaultLanguage);
  const sellable = (row: LiveProductRow) => row.active && row.available;

  for (const document of documents)
    live.set(
      document.menuId,
      offersInOrder(document).flatMap((offer): LiveOffer[] => {
        const dish = rows.get(offer.productId);
        if (dish === undefined) return [];
        return [
          {
            ...offer,
            available: sellable(dish),
            vatClass: dish.vatClass,
            courseId: dish.courseId,
            category: categoryOf(dish),
            variants: offer.variants.flatMap((variant) => {
              const row = rows.get(variant.id);
              return row === undefined
                ? []
                : [
                    {
                      ...variant,
                      available: sellable(row) && variant.offered,
                      vatClass: row.vatClass,
                      courseId: row.courseId,
                      category: categoryOf(row),
                    },
                  ];
            }),
            offeredModifiers: offer.offeredModifiers.map((entry): LiveOfferedModifier => {
              if (entry.kind === "options") {
                const withAvailability = entry.labels.map((label) => ({
                  ...label,
                  available: labels.get(label.id) === true,
                }));
                return {
                  ...entry,
                  labels: withAvailability,
                  defaultLabelId: withAvailability.some(
                    (label) => label.id === entry.defaultLabelId && label.available,
                  )
                    ? entry.defaultLabelId
                    : null,
                };
              }
              return {
                ...entry,
                items: entry.items.flatMap((item) => {
                  const row = rows.get(item.productId);
                  return row === undefined
                    ? []
                    : [
                        {
                          ...item,
                          vatClass: row.vatClass,
                          available:
                            sellable(row) &&
                            !withdrawn.has(itemKey(offer.id, entry.id, item.productId)),
                        },
                      ];
                }),
              };
            }),
          },
        ];
      }),
    );
  return live;
}

/** A change, with the library section a `shared_section` change happened in. */
export interface DiffEntry {
  change: MenuChange;
  section?: string;
}

type SectionNode = Extract<DocumentMember, { kind: "section" }>;

interface Shape {
  document: MenuDocument;
  /** Each section in menu order, with every path of section ids to a list holding it. */
  sections: Map<string, { node: SectionNode; parents: string[][] }>;
  /** Each offer in menu order, by product id. */
  offers: Map<string, FrozenOffer>;
  /** Each extras item's product, at its first appearance. */
  extras: Map<string, FrozenExtraItemFacts>;
}

type FrozenExtraItemFacts = Extract<FrozenOfferedModifier, { kind: "extras" }>["items"][number];

function shapeOf(document: MenuDocument): Shape {
  const sections = new Map<string, { node: SectionNode; parents: string[][] }>();
  const walk = (members: readonly DocumentMember[], path: string[]): void => {
    for (const member of members) {
      if (member.kind !== "section") continue;
      const known = sections.get(member.sectionId);
      if (known !== undefined) {
        known.parents.push(path);
        continue;
      }
      sections.set(member.sectionId, { node: member, parents: [path] });
      walk(member.members, [...path, member.sectionId]);
    }
  };
  walk(document.root.members, []);
  const offers = new Map(offersInOrder(document).map((offer) => [offer.productId, offer]));
  const extras = new Map<string, FrozenExtraItemFacts>();
  for (const offer of offers.values())
    for (const entry of offer.offeredModifiers)
      if (entry.kind === "extras")
        for (const item of entry.items)
          if (!extras.has(item.productId)) extras.set(item.productId, item);
  return { document, sections, offers, extras };
}

const same = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);
const pathKey = (path: readonly string[]): string => path.join("/");
const memberKey = (member: DocumentMember): string =>
  member.kind === "product" ? `p:${member.productId}` : `s:${member.sectionId}`;

function namesOf(shape: Shape, path: readonly string[]): string[] {
  return path.map((sectionId) => shape.sections.get(sectionId)!.node.internalName);
}

/** A change to the list at the end of `path`: the menu's own top level, or a library section. */
function listSource(path: readonly string[]): { source: MenuChangeSource; section?: string } {
  const holder = path.at(-1);
  return holder === undefined
    ? { source: "this_menu" }
    : { source: "shared_section", section: holder };
}

const PRODUCT_FIELD_ORDER: readonly ProductChangeField[] = [
  "names",
  "description",
  "image",
  "unit",
  "allergens",
  "diet",
  "variants",
  "extras",
  "options",
];

/** The facts a dish and each of its variants carry, by the field a change to them is named as. */
const PRODUCT_FACTS: readonly [ProductChangeField, readonly string[]][] = [
  ["names", ["name", "customerName", "kitchenName"]],
  ["image", ["image"]],
  ["unit", ["unit", "pricingUnit"]],
  ["allergens", ["allergens"]],
  ["diet", ["diet", "dietDerivation", "dietOverride", "dietaryDeclarations"]],
];

const EXTRA_FACTS: readonly [ProductChangeField, readonly string[]][] = [
  ["names", ["name", "customerName", "kitchenName"]],
  ["image", ["image"]],
  ["allergens", ["addAllergens"]],
  ["diet", ["suitableFor"]],
];

function changedFacts(
  facts: readonly [ProductChangeField, readonly string[]][],
  a: object,
  b: object,
  into: Set<ProductChangeField>,
): void {
  const read = (value: object, key: string) => (value as Record<string, unknown>)[key];
  for (const [field, keys] of facts)
    if (keys.some((key) => !same(read(a, key), read(b, key)))) into.add(field);
}

/** What an extras list offers on its dish, without the facts its items borrow from products. */
function extrasTerms(offer: FrozenOffer) {
  return offer.offeredModifiers.map((entry) =>
    entry.kind === "extras"
      ? {
          ...entry,
          items: entry.items.map(({ productId, price, maxQuantity, preselected }) => ({
            productId,
            price,
            maxQuantity,
            preselected,
          })),
        }
      : null,
  );
}

/** The fields that differ between two versions of one offer, the menu's own settings apart. */
function productFields(
  a: FrozenOffer,
  b: FrozenOffer,
): { shared: ProductChangeField[]; menu: ProductChangeField[] } {
  const shared = new Set<ProductChangeField>();
  const menu = new Set<ProductChangeField>();
  changedFacts(PRODUCT_FACTS, a, b, shared);
  if (!same(a.description, b.description)) shared.add("description");
  if (
    !same(
      a.variants.map((variant) => variant.id),
      b.variants.map((variant) => variant.id),
    )
  )
    shared.add("variants");
  const before = new Map(a.variants.map((variant) => [variant.id, variant]));
  for (const variant of b.variants) {
    const was = before.get(variant.id);
    if (was === undefined) continue;
    // A variant whose value matched the dish's both before and after moved with the dish, and the
    // dish's own field names that change.
    const read = (value: object, key: string) => (value as Record<string, unknown>)[key];
    const inherited = (keys: readonly string[]) =>
      keys.every(
        (key) => same(read(variant, key), read(b, key)) && same(read(was, key), read(a, key)),
      );
    for (const [, keys] of PRODUCT_FACTS)
      if (keys.some((key) => !same(read(was, key), read(variant, key))) && !inherited(keys))
        shared.add("variants");
    if (was.offered !== variant.offered || was.menuPrice !== variant.menuPrice)
      menu.add("variants");
    else if (was.unitPrice !== variant.unitPrice)
      (a.grossPrice === b.grossPrice ? shared : menu).add("variants");
  }
  if (!same(extrasTerms(a), extrasTerms(b))) shared.add("extras");
  const options = (offer: FrozenOffer) =>
    offer.offeredModifiers.map((entry) => (entry.kind === "options" ? entry : null));
  if (!same(options(a), options(b))) shared.add("options");
  const ordered = (fields: Set<ProductChangeField>) =>
    PRODUCT_FIELD_ORDER.filter((field) => fields.has(field));
  return { shared: ordered(shared), menu: ordered(menu) };
}

/**
 * The changes from `live` to `proposed`, each with the library section it happened in when that
 * decides its source. A change in a library section is named `shared_section` here; only the
 * caller, which can see the other menus, can tell whether another menu uses that section.
 */
export function diffEntries(live: MenuDocument | null, proposed: MenuDocument): DiffEntry[] {
  const next = shapeOf(proposed);
  const prev = shapeOf(live ?? { ...proposed, root: { members: [] }, offers: {}, homeLayouts: [] });
  const entries: DiffEntry[] = [];
  const push = (change: MenuChange, section?: string): void => {
    entries.push(section === undefined ? { change } : { change, section });
  };

  if (live !== null && live.menuName !== proposed.menuName)
    push({ kind: "menu_renamed", from: live.menuName, to: proposed.menuName, source: "this_menu" });

  for (const [sectionId, { node, parents }] of prev.sections) {
    const held = new Set(next.sections.get(sectionId)?.parents.map(pathKey));
    for (const parent of parents)
      if (!held.has(pathKey(parent))) {
        const { source, section } = listSource(parent);
        push(
          {
            kind: "section_removed",
            sectionId,
            name: node.internalName,
            under: namesOf(prev, parent),
            source,
          },
          section,
        );
      }
  }
  for (const [sectionId, { node, parents }] of next.sections) {
    const held = new Set(prev.sections.get(sectionId)?.parents.map(pathKey));
    for (const parent of parents)
      if (!held.has(pathKey(parent))) {
        const { source, section } = listSource(parent);
        push(
          {
            kind: "section_added",
            sectionId,
            name: node.internalName,
            under: namesOf(next, parent),
            source,
          },
          section,
        );
      }
  }
  for (const [sectionId, { node }] of next.sections) {
    const was = prev.sections.get(sectionId)?.node;
    if (was === undefined) continue;
    const fields: SectionChangeField[] = [];
    if (was.internalName !== node.internalName || !same(was.names, node.names))
      fields.push("names");
    if (was.image !== node.image) fields.push("image");
    if (was.color !== node.color) fields.push("color");
    if (fields.length > 0)
      push(
        {
          kind: "section_changed",
          sectionId,
          name: node.internalName,
          fields,
          source: "shared_section",
        },
        sectionId,
      );
  }

  for (const [productId, was] of prev.offers) {
    const offer = next.offers.get(productId);
    if (offer === undefined) {
      const { source, section } = listSource(was.placements[0]!);
      push(
        {
          kind: "product_removed",
          productId,
          name: was.name,
          under: namesOf(prev, was.placements[0]!),
          source,
        },
        section,
      );
      continue;
    }
    const from = new Set(was.placements.map(pathKey));
    const to = new Set(offer.placements.map(pathKey));
    const moved = [
      ...was.placements.filter((path) => !to.has(pathKey(path))),
      ...offer.placements.filter((path) => !from.has(pathKey(path))),
    ];
    if (moved.length > 0) {
      const library = moved.map((path) => path.at(-1)).find((holder) => holder !== undefined);
      push(
        {
          kind: "product_moved",
          productId,
          name: offer.name,
          from: was.placements.map((path) => namesOf(prev, path)),
          to: offer.placements.map((path) => namesOf(next, path)),
          source: library === undefined ? "this_menu" : "shared_section",
        },
        library,
      );
    }
    if (was.unitPrice !== offer.unitPrice || was.grossPrice !== offer.grossPrice)
      push({
        kind: "price_changed",
        productId,
        name: offer.name,
        from: was.unitPrice,
        to: offer.unitPrice,
        source: was.grossPrice === offer.grossPrice ? "shared_product" : "this_menu",
      });
    const { shared, menu } = productFields(was, offer);
    if (shared.length > 0)
      push({
        kind: "product_changed",
        productId,
        name: offer.name,
        fields: shared,
        source: "shared_product",
      });
    if (menu.length > 0)
      push({
        kind: "product_changed",
        productId,
        name: offer.name,
        fields: menu,
        source: "this_menu",
      });
  }
  for (const [productId, offer] of next.offers) {
    if (prev.offers.has(productId)) continue;
    const { source, section } = listSource(offer.placements[0]!);
    push(
      {
        kind: "product_added",
        productId,
        name: offer.name,
        under: namesOf(next, offer.placements[0]!),
        source,
      },
      section,
    );
  }

  for (const [productId, item] of next.extras) {
    const was = prev.extras.get(productId);
    if (was === undefined || (prev.offers.has(productId) && next.offers.has(productId))) continue;
    const fields = new Set<ProductChangeField>();
    changedFacts(EXTRA_FACTS, was, item, fields);
    if (fields.size > 0)
      push({
        kind: "product_changed",
        productId,
        name: item.name,
        fields: PRODUCT_FIELD_ORDER.filter((field) => fields.has(field)),
        source: "shared_product",
      });
  }

  const listKeys = (shape: Shape, list: string | null) =>
    list === null
      ? shape.document.root.members.map(memberKey)
      : shape.sections.get(list)?.node.members.map(memberKey);
  for (const list of [null, ...next.sections.keys()]) {
    const before = listKeys(prev, list);
    if (before === undefined) continue;
    const after = listKeys(next, list)!;
    const common = (keys: string[], other: string[]) => keys.filter((key) => other.includes(key));
    if (same(common(before, after), common(after, before))) continue;
    if (list === null) push({ kind: "order_changed", list: [], source: "this_menu" });
    else {
      const path = [...next.sections.get(list)!.parents[0]!, list];
      push({ kind: "order_changed", list: namesOf(next, path), source: "shared_section" }, list);
    }
  }

  const layoutsBefore = new Map((live?.homeLayouts ?? []).map((layout) => [layout.id, layout]));
  for (const layout of proposed.homeLayouts) {
    const was = layoutsBefore.get(layout.id);
    const changed =
      was === undefined
        ? live !== null || layout.tiles.length > 0
        : was.name !== layout.name || !same(was.tiles, layout.tiles);
    if (changed)
      push({ kind: "layout_changed", layoutId: layout.id, name: layout.name, source: "this_menu" });
  }
  const kept = new Set(proposed.homeLayouts.map((layout) => layout.id));
  for (const was of layoutsBefore.values())
    if (!kept.has(was.id))
      push({ kind: "layout_changed", layoutId: was.id, name: was.name, source: "this_menu" });
  if (live !== null && live.defaultHomeLayoutId !== proposed.defaultHomeLayoutId) {
    const nameIn = (document: MenuDocument) =>
      document.homeLayouts.find((layout) => layout.id === document.defaultHomeLayoutId)!.name;
    push({
      kind: "default_layout_changed",
      from: nameIn(live),
      to: nameIn(proposed),
      source: "this_menu",
    });
  }
  return entries;
}

/** What publishing `proposed` would change from `live`; null is a menu never published. */
export function diffMenuDocuments(live: MenuDocument | null, proposed: MenuDocument): MenuChange[] {
  return diffEntries(live, proposed).map((entry) => entry.change);
}
