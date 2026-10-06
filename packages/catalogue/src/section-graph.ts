import { catalogues, type Transaction } from "@waitron/db";
import { sectionMembers, sections } from "./schema/sections.js";
import type { SectionMember, SectionRole, TileRef } from "./section-types.js";

export interface SectionRow {
  id: string;
  role: SectionRole;
  internalName?: string;
  names?: Record<string, string>;
  image?: string | null;
  color?: string | null;
  ownerMenuId: string;
}

export interface MemberRow {
  id: string;
  sectionId: string;
  position: number;
  productId: string | null;
  childSectionId: string | null;
  missingName?: string | null;
}

/** Every section and every membership, held in memory for one operation. */
export interface SectionGraph {
  /** Structural members by position; Home is empty here. Use tiles for its complete view. */
  children(sectionId: string): SectionMember[];
  tiles(homeSectionId: string): SectionMember<TileRef>[];
  /** The lists that hold this section directly. */
  parents(sectionId: string): string[];
  role(sectionId: string): SectionRole | undefined;
  ownerMenu(sectionId: string): string | null;
  section(sectionId: string): SectionRow | undefined;
  menu(menuId: string): { name: string; active: boolean } | undefined;
  roots(): { menuId: string; sectionId: string }[];
}

export function toSectionMember(row: MemberRow): SectionMember<TileRef> {
  return {
    id: row.id,
    position: row.position,
    ref:
      row.childSectionId === null
        ? row.productId === null
          ? { kind: "missing", name: row.missingName! }
          : { kind: "product", productId: row.productId }
        : { kind: "section", sectionId: row.childSectionId },
  };
}

export function buildSectionGraph(
  sections: readonly SectionRow[],
  members: readonly MemberRow[],
  menus: readonly { id: string; name: string; active: boolean }[] = [],
): SectionGraph {
  const byMenu = new Map(menus.map((row) => [row.id, row]));
  const byId = new Map(sections.map((row) => [row.id, row]));
  const children = new Map<string, SectionMember<TileRef>[]>();
  const parents = new Map<string, Set<string>>();
  const ordered = [...members].sort(
    (a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  for (const row of ordered) {
    const list = children.get(row.sectionId) ?? [];
    list.push(toSectionMember(row));
    children.set(row.sectionId, list);
    if (row.childSectionId !== null) {
      const holders = parents.get(row.childSectionId) ?? new Set<string>();
      holders.add(row.sectionId);
      parents.set(row.childSectionId, holders);
    }
  }
  return {
    section: (sectionId) => byId.get(sectionId),
    menu: (menuId) => byMenu.get(menuId),
    roots: () =>
      sections
        .filter((row) => row.role === "menu_root")
        .map((row) => ({ menuId: row.ownerMenuId!, sectionId: row.id })),
    children: (sectionId) =>
      byId.get(sectionId)?.role === "home_layout"
        ? []
        : (children.get(sectionId) ?? []).filter(
            (member): member is SectionMember => member.ref.kind !== "missing",
          ),
    tiles: (homeSectionId) => children.get(homeSectionId) ?? [],
    parents: (sectionId) => [...(parents.get(sectionId) ?? [])],
    role: (sectionId) => byId.get(sectionId)?.role,
    ownerMenu: (sectionId) => byId.get(sectionId)?.ownerMenuId ?? null,
  };
}

export async function loadSectionGraph(tx: Transaction): Promise<SectionGraph> {
  const sectionRows = await tx.select().from(sections);
  const memberRows = await tx
    .select({
      id: sectionMembers.id,
      sectionId: sectionMembers.sectionId,
      position: sectionMembers.position,
      productId: sectionMembers.productId,
      childSectionId: sectionMembers.childSectionId,
      missingName: sectionMembers.missingName,
    })
    .from(sectionMembers);
  const menus = await tx
    .select({ id: catalogues.id, name: catalogues.name, active: catalogues.active })
    .from(catalogues);
  return buildSectionGraph(sectionRows, memberRows, menus);
}

function childSections(graph: SectionGraph, sectionId: string): string[] {
  return graph
    .children(sectionId)
    .flatMap((member) => (member.ref.kind === "section" ? [member.ref.sectionId] : []));
}

/** Would `parentId` holding `childId` let a section reach itself? */
export function wouldCreateCycle(graph: SectionGraph, parentId: string, childId: string): boolean {
  const seen = new Set<string>();
  const pending = [childId];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === parentId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    pending.push(...childSections(graph, current));
  }
  return false;
}

/**
 * Every product the root reaches, depth first in member order, each at its first occurrence; and
 * every section a list the root reaches holds.
 */
export function reachableFrom(
  graph: SectionGraph,
  rootId: string,
): { products: string[]; sections: Set<string> } {
  const products = new Set<string>();
  const sections = new Set<string>();
  const visited = new Set<string>();
  const walk = (sectionId: string): void => {
    if (visited.has(sectionId)) return;
    visited.add(sectionId);
    for (const { ref } of graph.children(sectionId)) {
      if (ref.kind === "product") products.add(ref.productId);
      else {
        sections.add(ref.sectionId);
        walk(ref.sectionId);
      }
    }
  };
  walk(rootId);
  return { products: [...products], sections };
}

export function reachableProducts(graph: SectionGraph, rootId: string): string[] {
  return reachableFrom(graph, rootId).products;
}

/** For every product the root reaches, each path of section ids from the root to a list holding it
 * directly. */
export function placementsByProduct(graph: SectionGraph, rootId: string): Map<string, string[][]> {
  const found = new Map<string, string[][]>();
  const walk = (path: string[]): void => {
    const sectionId = path[path.length - 1]!;
    for (const { ref } of graph.children(sectionId)) {
      if (ref.kind === "product") {
        const paths = found.get(ref.productId) ?? [];
        paths.push(path);
        found.set(ref.productId, paths);
      } else if (!path.includes(ref.sectionId)) walk([...path, ref.sectionId]);
    }
  };
  walk([rootId]);
  return found;
}

/** The menus whose root reaches the section, sorted. A Device Home Page holding it does not count. */
export function menusContaining(graph: SectionGraph, sectionId: string): string[] {
  const menus = new Set<string>();
  const seen = new Set<string>();
  const pending = [sectionId];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    if (graph.role(current) === "menu_root") menus.add(graph.ownerMenu(current)!);
    pending.push(...graph.parents(current));
  }
  return [...menus].sort();
}

/** The target's path within its owning menu, independent of including menus and Device Home
 * Pages. */
export function sectionPathName(graph: SectionGraph, sectionId: string): string {
  const owner = graph.ownerMenu(sectionId)!;
  const path: string[] = [];
  let current = sectionId;
  while (graph.role(current) === "section") {
    path.unshift(graph.section(current)!.internalName!);
    const parent = graph
      .parents(current)
      .find((id) => graph.role(id) !== "home_layout" && graph.ownerMenu(id) === owner);
    if (parent === undefined) break;
    current = parent;
  }
  return [graph.menu(owner)!.name, ...path].join(" › ");
}
