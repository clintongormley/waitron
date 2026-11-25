import { createHash } from "node:crypto";
import { now, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import "./errors.js";
import { canonicalJson } from "./menu-document.js";
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
  const current = await readProductDeclarationValues(
    tx,
    [live, ...waiting].flatMap(({ document }) => declaredProductIds(document)),
  );
  const declarations = Object.fromEntries(current);
  const queued = queuedDeclarationDrift(waiting, current, liveDeclarations(live.document));
  const revision = createHash("sha256")
    .update(canonicalJson({ declarations, queued }))
    .digest("hex");
  return { ...live, revision, declarations, queued };
}

/** Refuses `menu_patch.declarations_changed` unless the draft of the live version `baseVersionId`
 * still has the `revision` that was reviewed; another live version is the patch's to refuse. */
export async function assertPatchReviewed(
  tx: Transaction,
  menuId: string,
  baseVersionId: string,
  revision: string,
  at: Date = now(),
): Promise<void> {
  const draft = await readPatchDraft(tx, menuId, at);
  if (draft?.versionId === baseVersionId && draft.revision !== revision)
    throw new AppError("menu_patch.declarations_changed", { menuId });
}
