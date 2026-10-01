import type { Transaction } from "@waitron/db";
import { createCatalogue } from "../src/operations.js";
import { requireMenuRoot } from "../src/menu-structure.js";
import { readSection } from "../src/sections.js";
import type { SectionInput, SectionDetails } from "../src/section-types.js";

/** A standalone menu root for tests that include the same content from several menus. */
export async function createIncludedMenu(
  tx: Transaction,
  input: SectionInput,
): Promise<SectionDetails & { ownerMenuId: string }> {
  const menu = await createCatalogue(tx, {
    name: input.internalName,
    names: input.names,
    image: input.image,
    color: input.color,
  });
  return { ...(await readSection(tx, await requireMenuRoot(tx, menu.id))), ownerMenuId: menu.id };
}
