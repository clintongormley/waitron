import type { Transaction } from "@waitron/db";
import type { SetMenuLine } from "@waitron/shared";
import { syncMenuOffers } from "./menu-structure.js";
import type { SectionGraph } from "./section-graph.js";
import { addLinesForCourses } from "./set-menus.js";

export async function onStructureChanged(
  tx: Transaction,
  menuIds: readonly string[],
  before: SectionGraph,
): Promise<Map<string, SetMenuLine[]>> {
  const addedLines = new Map<string, SetMenuLine[]>();
  for (const [menuId, productIds] of await syncMenuOffers(tx, menuIds, before))
    addedLines.set(menuId, await addLinesForCourses(tx, menuId, productIds));
  return addedLines;
}
