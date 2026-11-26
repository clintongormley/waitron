import {
  decimal,
  stringToCents,
  type CombinedOffer,
  type Decimal,
  type MenuPriceRow,
  type MenuStructureMemberInput,
  type MenuStructurePriceInput,
  type MenuStructureSaveInput,
  type IncludeFolderInput,
  type SectionInput,
} from "@waitron/shared";
import { combineOffer } from "@waitron/menu/src/menu-combine.js";
import { isProductPrice } from "@waitron/menu/src/modifier-limits.js";
import type { Product } from "../api/client.js";
import type { MenuStructure, MenuStructureNode } from "../api/menu-api.js";

type Member = { listId: string; memberId: string };
type IncludedMenu = { structure: MenuStructure; offers: Map<string, CombinedOffer> };

export const structurePriceKey = (productId: string, variantId?: string): string =>
  variantId === undefined ? productId : `${productId}:${variantId}`;

function explicitPrices(rows: readonly MenuPriceRow[]): MenuStructurePriceInput[] {
  return rows.flatMap(({ productId, override, variants }) => [
    ...(override === null ? [] : [{ productId, price: override }]),
    ...variants.flatMap(({ variantId, price }) =>
      price === null ? [] : [{ productId, variantId, price }],
    ),
  ]);
}

function memberInput({ memberId, ref, folder }: MenuStructureNode): MenuStructureMemberInput {
  return { id: memberId, ref, ...(folder === undefined ? {} : { folder }) };
}

function editList(
  structure: MenuStructure,
  listId: string,
  edit: (nodes: MenuStructureNode[]) => MenuStructureNode[],
): MenuStructure {
  function walk(nodes: MenuStructureNode[]): MenuStructureNode[] {
    return nodes.map((node) => {
      if (node.ref.kind !== "section" || node.includedMenuId !== undefined) return node;
      const children = node.children ?? [];
      return { ...node, children: node.ref.sectionId === listId ? edit(children) : walk(children) };
    });
  }
  const nodes = listId === structure.rootSectionId ? edit(structure.nodes) : walk(structure.nodes);
  return { ...structure, nodes };
}

function listAt(structure: MenuStructure, listId: string): readonly MenuStructureNode[] {
  function find(nodes: readonly MenuStructureNode[]): readonly MenuStructureNode[] | undefined {
    for (const node of nodes) {
      if (node.ref.kind !== "section" || node.includedMenuId !== undefined) continue;
      if (node.ref.sectionId === listId) return node.children ?? [];
      const found = find(node.children ?? []);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  return listId === structure.rootSectionId ? structure.nodes : (find(structure.nodes) ?? []);
}

function refKey({ ref }: MenuStructureNode): string {
  switch (ref.kind) {
    case "product":
      return `product:${ref.productId}`;
    case "section":
      return `section:${ref.sectionId}`;
    case "set_menu":
      return `set_menu:${ref.menuId}`;
  }
}

function placedProducts(nodes: readonly MenuStructureNode[]): Set<string> {
  const ids = new Set<string>();
  function walk(rows: readonly MenuStructureNode[]): void {
    for (const node of rows) {
      if (node.ref.kind === "product") ids.add(node.ref.productId);
      if (node.children) walk(node.children);
    }
  }
  walk(nodes);
  return ids;
}

function ownedNodes(nodes: readonly MenuStructureNode[]): MenuStructureNode[] {
  return nodes.flatMap((node) =>
    node.includedMenuId === undefined ? [node, ...ownedNodes(node.children ?? [])] : [node],
  );
}

const asPrice = (value: string): Decimal | null => (isProductPrice(value) ? decimal(value) : null);

export class MenuStructureDraft {
  #saved: MenuStructure | null = null;
  #savedPrices: MenuStructurePriceInput[] = [];
  #comparison = "";
  #prices: MenuStructurePriceInput[] = [];
  #removedPrices = new Set<string>();
  #includes = new Map<string, IncludedMenu>();
  structure: MenuStructure | null = null;

  get dirty(): boolean {
    return this.structure !== null && JSON.stringify(this.input()) !== this.#comparison;
  }

  accept(structure: MenuStructure, rows: readonly MenuPriceRow[]): void {
    const dirty = this.dirty;
    this.#saved = structure;
    this.#savedPrices = explicitPrices(rows);
    if (!dirty) this.restore();
  }

  restore(): void {
    this.structure = this.#saved;
    this.#prices = this.#savedPrices;
    this.#removedPrices.clear();
    this.#applyIncludes();
    this.commit();
  }

  commit(): void {
    const input = this.input();
    this.#comparison = JSON.stringify(input);
    this.#saved = this.structure;
    this.#savedPrices = input.prices;
    this.#prices = this.#savedPrices;
    this.#removedPrices.clear();
  }

  reset(): void {
    this.#saved = null;
    this.#savedPrices = [];
    this.#includes.clear();
    this.restore();
  }

  append(listId: string, rows: MenuStructureNode[]): void {
    if (this.structure === null) return;
    this.structure = editList(this.structure, listId, (nodes) => {
      const held = new Set(nodes.map(refKey));
      return [...nodes, ...rows.filter((node) => !held.has(refKey(node)))];
    });
    this.#applyIncludes();
  }

  editSection(id: string, input: SectionInput): void {
    if (!this.structure) return;
    const visit = (nodes: MenuStructureNode[]): MenuStructureNode[] =>
      nodes.map((node) => {
        if (node.ref.kind !== "section" || node.includedMenuId !== undefined) return node;
        return node.ref.sectionId === id
          ? { ...node, ...input }
          : { ...node, children: visit(node.children ?? []) };
      });
    this.structure = { ...this.structure, nodes: visit(this.structure.nodes) };
  }

  editFolder(listId: string, memberId: string, input: IncludeFolderInput): void {
    if (!this.structure) return;
    const folder = { showAsFolder: input.showAsFolder, overrides: input.overrides ?? {} };
    this.structure = editList(this.structure, listId, (nodes) =>
      nodes.map((node) => (node.memberId === memberId ? { ...node, folder } : node)),
    );
  }

  get directIncludes(): string[] {
    return [
      ...new Set(
        ownedNodes(this.structure?.nodes ?? []).flatMap(
          ({ includedMenuId }) => includedMenuId ?? [],
        ),
      ),
    ];
  }

  include(menuId: string, structure: MenuStructure, prices: readonly MenuPriceRow[]): void {
    this.#includes.set(menuId, {
      structure,
      offers: new Map(prices.map(({ productId, combined }) => [productId, combined])),
    });
    this.#applyIncludes();
  }

  #applyIncludes(): void {
    if (this.structure === null || this.#includes.size === 0) return;
    const walk = (nodes: MenuStructureNode[]): MenuStructureNode[] =>
      nodes.map((node) => {
        if (node.includedMenuId !== undefined) {
          const source = this.#includes.get(node.includedMenuId)?.structure;
          if (!source) return node;
          const { internalName, names, color, image } = source.root;
          return { ...node, internalName, names, color, image, children: source.nodes };
        }
        return node.children ? { ...node, children: walk(node.children) } : node;
      });
    this.structure = { ...this.structure, nodes: walk(this.structure.nodes) };
  }

  price(productId: string, variantId?: string): string {
    return (
      this.#prices.find((entry) => entry.productId === productId && entry.variantId === variantId)
        ?.price ?? ""
    );
  }

  priceChanged(productId: string, variantId?: string): boolean {
    const saved = this.#savedPrices.find(
      (price) => price.productId === productId && price.variantId === variantId,
    );
    return (saved?.price ?? "") !== this.price(productId, variantId);
  }

  setPrice(productId: string, variantId: string | undefined, text: string): void {
    const value = text.trim();
    const previous = this.price(productId, variantId);
    const amount = asPrice(value);
    if (
      value === previous ||
      (amount !== null &&
        asPrice(previous) !== null &&
        stringToCents(value) === stringToCents(previous))
    )
      return;
    const match = (entry: MenuStructurePriceInput) =>
      entry.productId === productId && entry.variantId === variantId;
    const changed = { productId, variantId, price: value };
    this.#prices =
      value === ""
        ? this.#prices.filter((entry) => !match(entry))
        : this.#prices.some(match)
          ? this.#prices.map((entry) => (match(entry) ? changed : entry))
          : [...this.#prices, changed];
  }

  offers(
    products: readonly Product[],
    menus: ReadonlyMap<string, string>,
  ): Map<string, CombinedOffer> {
    const directlyPlaced = new Set(
      ownedNodes(this.structure?.nodes ?? []).flatMap(({ ref }) =>
        ref.kind === "product" ? ref.productId : [],
      ),
    );
    const includes = this.directIncludes;
    const offers = new Map<string, CombinedOffer>();
    for (const product of products) {
      const productId = product.id;
      const placedInOwnSections = directlyPlaced.has(productId);
      const included = includes.flatMap((menuId) => {
        const offer = this.#includes.get(menuId)?.offers.get(productId);
        return offer === undefined ? [] : [{ menuId, menuName: menus.get(menuId) ?? "", offer }];
      });
      if (product.unitPrice === undefined || (!placedInOwnSections && included.length === 0))
        continue;
      const variants = (product.variants ?? []).filter(({ active }) => active !== false);
      offers.set(
        productId,
        combineOffer({
          productId,
          product: {
            price: decimal(product.unitPrice),
            variants: variants.map(({ id, unitPrice }) => ({
              variantId: id,
              price: unitPrice ? decimal(unitPrice) : null,
            })),
          },
          own: {
            price: variants.length === 0 ? asPrice(this.price(productId)) : null,
            variants: variants.map(({ id }) => ({
              variantId: id,
              price: asPrice(this.price(productId, id)),
            })),
          },
          placedInOwnSections,
          included,
        }),
      );
    }
    return offers;
  }

  remove(members: readonly Member[]): void {
    if (this.structure === null) return;
    const before = placedProducts(this.structure.nodes);
    const sections = new Set<string>();
    const removals = new Map<string, Set<string>>();
    for (const { listId, memberId } of members) {
      const ids = removals.get(listId) ?? new Set<string>();
      ids.add(memberId);
      removals.set(listId, ids);
      const node = listAt(this.structure, listId).find((row) => row.memberId === memberId);
      if (node?.ref.kind !== "section" || node.includedMenuId !== undefined) continue;
      for (const child of ownedNodes([node]))
        if (child.ref.kind === "section" && child.includedMenuId === undefined)
          sections.add(child.ref.sectionId);
    }
    const keep = (list: string, nodes: MenuStructureNode[]): MenuStructureNode[] =>
      nodes.flatMap((node) => {
        if (removals.get(list)?.has(node.memberId)) return [];
        if (node.ref.kind !== "section" || node.includedMenuId !== undefined) return [node];
        if (sections.has(node.ref.sectionId)) return [];
        return [{ ...node, children: keep(node.ref.sectionId, node.children ?? []) }];
      });
    this.structure = {
      ...this.structure,
      nodes: keep(this.structure.rootSectionId, this.structure.nodes),
    };
    const after = placedProducts(this.structure.nodes);
    for (const productId of before) if (!after.has(productId)) this.#removedPrices.add(productId);
  }

  move(members: readonly Member[], destination: string, position?: number): boolean {
    let structure = this.structure;
    if (structure === null) return false;
    const moved: MenuStructureNode[] = [];
    const remove = new Map<string, Set<string>>();
    for (const { listId, memberId } of members) {
      const node = listAt(structure, listId).find((row) => row.memberId === memberId);
      if (node === undefined) return false;
      moved.push(node);
      const ids = remove.get(listId) ?? new Set<string>();
      ids.add(memberId);
      remove.set(listId, ids);
    }
    const refs = [
      ...listAt(structure, destination).filter(
        (node) => !remove.get(destination)?.has(node.memberId),
      ),
      ...moved,
    ].map(refKey);
    if (refs.length !== new Set(refs).size) return false;
    for (const [listId, ids] of remove)
      structure = editList(structure, listId, (nodes) =>
        nodes.filter((node) => !ids.has(node.memberId)),
      );
    this.structure = editList(structure, destination, (nodes) => {
      const to = position ?? nodes.length;
      return [...nodes.slice(0, to), ...moved, ...nodes.slice(to)];
    });
    return true;
  }

  input(): MenuStructureSaveInput {
    const sections = new Map<string, MenuStructureSaveInput["sections"][number]>();
    function collect(nodes: readonly MenuStructureNode[]): void {
      for (const node of nodes) {
        if (node.ref.kind !== "section" || node.includedMenuId !== undefined) continue;
        const id = node.ref.sectionId;
        if (sections.has(id)) continue;
        const children = node.children ?? [];
        sections.set(id, {
          id,
          internalName: node.internalName ?? "",
          names: node.names ?? {},
          image: node.image ?? null,
          color: node.color ?? null,
          members: children.map(memberInput),
        });
        collect(children);
      }
    }
    const nodes = this.structure?.nodes ?? [];
    collect(nodes);
    const placed = this.#removedPrices.size ? placedProducts(nodes) : undefined;
    return {
      rootMembers: nodes.map(memberInput),
      sections: [...sections.values()],
      prices: this.#prices.filter(
        ({ productId }) => !this.#removedPrices.has(productId) || placed?.has(productId),
      ),
    };
  }
}
