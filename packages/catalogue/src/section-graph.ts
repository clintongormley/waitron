import type { Transaction } from "@waitron/db";
import { sectionMembers, sections } from "./schema/sections.js";
import type { SectionMember, SectionRole } from "./section-types.js";

export interface SectionRow {
  id: string;
  role: SectionRole;
  ownerMenuId: string | null;
}

export interface MemberRow {
  id: string;
  sectionId: string;
  position: number;
  productId: string | null;
  childSectionId: string | null;
}

/** Every section and every membership, held in memory for one operation. */
export interface SectionGraph {
  /** A list's members by position, a tie sorted by member id. */
  children(sectionId: string): SectionMember[];
  /** The lists that hold this section directly. */
  parents(sectionId: string): string[];
  role(sectionId: string): SectionRole | undefined;
  ownerMenu(sectionId: string): string | null;
}

export function toSectionMember(row: MemberRow): SectionMember {
  return {
    id: row.id,
    position: row.position,
    ref:
      row.childSectionId === null
        ? { kind: "product", productId: row.productId! }
        : { kind: "section", sectionId: row.childSectionId },
  };
}

export function buildSectionGraph(
  sections: readonly SectionRow[],
  members: readonly MemberRow[],
): SectionGraph {
  const byId = new Map(sections.map((row) => [row.id, row]));
  const children = new Map<string, SectionMember[]>();
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
    children: (sectionId) => children.get(sectionId) ?? [],
    parents: (sectionId) => [...(parents.get(sectionId) ?? [])],
    role: (sectionId) => byId.get(sectionId)?.role,
    ownerMenu: (sectionId) => byId.get(sectionId)?.ownerMenuId ?? null,
  };
}

/** Two reads, taken once per operation; the graph is small and walked in JavaScript. */
export async function loadSectionGraph(tx: Transaction): Promise<SectionGraph> {
  const sectionRows = await tx
    .select({ id: sections.id, role: sections.role, ownerMenuId: sections.ownerMenuId })
    .from(sections);
  const memberRows = await tx
    .select({
      id: sectionMembers.id,
      sectionId: sectionMembers.sectionId,
      position: sectionMembers.position,
      productId: sectionMembers.productId,
      childSectionId: sectionMembers.childSectionId,
    })
    .from(sectionMembers);
  return buildSectionGraph(sectionRows, memberRows);
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

/** Every product the root reaches, depth first in member order, each at its first occurrence. */
export function reachableProducts(graph: SectionGraph, rootId: string): string[] {
  const products = new Set<string>();
  const visited = new Set<string>();
  const walk = (sectionId: string): void => {
    if (visited.has(sectionId)) return;
    visited.add(sectionId);
    for (const { ref } of graph.children(sectionId)) {
      if (ref.kind === "product") products.add(ref.productId);
      else walk(ref.sectionId);
    }
  };
  walk(rootId);
  return [...products];
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

/** The menus whose root reaches the section, sorted. A home layout holding it does not count. */
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
