import { now, type Transaction } from "@waitron/db";
import {
  declaredProductIds,
  liveDeclarations,
  queuedDeclarationDrift,
} from "./menu-patch-declarations.js";
import type { PatchDraft } from "./menu-patch-types.js";
import { readLiveMenu, waitingEditions } from "./menu-publication.js";
import { readProductDeclarationValues } from "./product-declarations.js";

/** What Patch live menu starts from, or `null` for a menu with no live version. */
export async function readPatchDraft(
  tx: Transaction,
  menuId: string,
  at: Date = now(),
): Promise<PatchDraft | null> {
  const live = await readLiveMenu(tx, menuId, at);
  if (live === null) return null;
  const waiting = await waitingEditions(tx, menuId, at);
  if (waiting.length === 0) return { ...live, queued: [] };
  const current = await readProductDeclarationValues(
    tx,
    [live, ...waiting].flatMap(({ document }) => declaredProductIds(document)),
  );
  return {
    ...live,
    queued: queuedDeclarationDrift(waiting, current, liveDeclarations(live.document)),
  };
}
