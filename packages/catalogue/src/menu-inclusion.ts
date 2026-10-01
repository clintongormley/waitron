import { wouldCreateCycle, type SectionGraph } from "./section-graph.js";

function rootOf(graph: SectionGraph, menuId: string): string | undefined {
  return graph.roots().find((root) => root.menuId === menuId)?.sectionId;
}

/** Direct inclusions, discovered in the menu's own lists in depth-first member order. */
export function directIncludedMenus(graph: SectionGraph, menuId: string): string[] {
  const found = new Set<string>();
  const visited = new Set<string>();
  const walk = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const { ref } of graph.children(id)) {
      if (ref.kind !== "section") continue;
      if (graph.role(ref.sectionId) === "menu_root") {
        const included = graph.ownerMenu(ref.sectionId)!;
        found.add(included);
      } else walk(ref.sectionId);
    }
  };
  const root = rootOf(graph, menuId);
  if (root !== undefined) walk(root);
  return [...found];
}

export function includedMenus(graph: SectionGraph, menuId: string): string[] {
  return directIncludedMenus(graph, menuId).filter((id) => graph.menu(id)?.active);
}

export function placesOf(
  graph: SectionGraph,
  menuId: string,
  productId: string,
): { own: boolean; via: string[] } {
  let own = false;
  const visited = new Set<string>();
  const walk = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);
    for (const { ref } of graph.children(id)) {
      if (ref.kind === "product") {
        if (ref.productId === productId) own = true;
      } else if (graph.role(ref.sectionId) === "section") walk(ref.sectionId);
    }
  };
  const root = rootOf(graph, menuId);
  if (root !== undefined) walk(root);
  const contributes = (menu: string): boolean => {
    const seen = new Set<string>();
    const reaches = (id: string): boolean => {
      if (seen.has(id)) return false;
      seen.add(id);
      return graph.children(id).some(({ ref }) => {
        if (ref.kind === "product") return ref.productId === productId;
        if (
          graph.role(ref.sectionId) === "menu_root" &&
          !graph.menu(graph.ownerMenu(ref.sectionId)!)?.active
        )
          return false;
        return reaches(ref.sectionId);
      });
    };
    return reaches(rootOf(graph, menu)!);
  };
  return { own, via: includedMenus(graph, menuId).filter(contributes) };
}

export function includableMenus(graph: SectionGraph, menuId: string): string[] {
  const root = rootOf(graph, menuId);
  if (root === undefined) return [];
  return graph
    .roots()
    .filter(
      (other) =>
        other.menuId !== menuId &&
        graph.menu(other.menuId)?.active &&
        !wouldCreateCycle(graph, root, other.sectionId),
    )
    .map((other) => other.menuId);
}
