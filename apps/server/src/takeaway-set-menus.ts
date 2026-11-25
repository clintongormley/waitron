import type { Transaction } from "@waitron/db";
import { readRecordedDocuments } from "@waitron/menu";
import { AppError, setMenuProductIds } from "@waitron/shared";
import "./errors.js";

/**
 * The products each set menu's recorded copy can hold (`setMenuProductIds`), at its index. Refused
 * `menu.reset_required` when a copy cannot be read or no longer holds its set menu.
 */
export async function recordedProducts(
  tx: Transaction,
  copies: readonly { setMenuId: string; versionId: string }[],
): Promise<string[][]> {
  if (copies.length === 0) return [];
  const documents = await readRecordedDocuments(
    tx,
    copies.map(({ versionId }) => versionId),
  );
  return copies.map(({ setMenuId, versionId }) => {
    const copy = documents.get(versionId)?.setMenus?.[setMenuId];
    if (copy === undefined) throw new AppError("menu.reset_required", { menuId: setMenuId });
    return setMenuProductIds(copy);
  });
}
