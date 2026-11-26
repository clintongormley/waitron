import type { Transaction } from "@waitron/db";
import type { MenuHomeSaveInput, ShortcutRef } from "@waitron/shared";
import { readMenuHome, saveMenuHome } from "../src/menu-home.js";

export async function editMenuHome(
  tx: Transaction,
  menuId: string,
  edit: (draft: MenuHomeSaveInput) => void,
) {
  const home = await readMenuHome(tx, menuId);
  const draft: MenuHomeSaveInput = {
    order: home.order,
    shortcuts: home.shortcuts.map(({ memberId, ref }) => ({ memberId, ref })),
  };
  edit(draft);
  return saveMenuHome(tx, menuId, draft);
}

export async function addShortcut(
  tx: Transaction,
  menuId: string,
  ref: ShortcutRef,
  position?: number,
) {
  const id = crypto.randomUUID();
  const saved = await editMenuHome(tx, menuId, ({ shortcuts }) => {
    shortcuts.splice(position ?? shortcuts.length, 0, { memberId: id, ref });
  });
  const tile = saved.shortcuts.find(({ memberId }) => memberId === id);
  if (!tile) throw new Error("The fixture's shortcut target was dropped");
  return { id, position: tile.position, ref };
}
