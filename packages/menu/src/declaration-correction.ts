import { and, asc, eq, gt } from "drizzle-orm";
import { menuReleases, menus, menuVersions, now, type Transaction } from "@waitron/db";
import type { MenuDocument } from "@waitron/shared";
import type { DeclarationValues } from "./declaration-values.js";
import { canonicalJson } from "./menu-document.js";
import { declarationsFor } from "./menu-patch.js";
import { declarationCopies, type DeclarationCopy } from "./menu-patch-declarations.js";
import type { MenuPatchChange } from "./menu-patch-types.js";
import { liveVersions } from "./menu-publication.js";
import { readProductDeclarationValues } from "./product-declarations.js";

export interface DeclarationDrift {
  menuId: string;
  name: string;
  liveVersionId: string | null;
  /** The changes the live version needs; empty when it agrees or there is none. */
  live: MenuPatchChange[];
  /** Each disagreeing queued version, earliest first (owner, 2026-11-25 10:02). */
  queued: QueuedDeclarationCorrection[];
}

export interface QueuedDeclarationCorrection {
  versionId: string;
  activatesAt: string;
  changes: MenuPatchChange[];
  /** Every differing copy still holds the value before the save. */
  stillOld: boolean;
}

export interface DeclarationMenu {
  menuId: string;
  name: string;
  /** The live version disagrees, so Update now corrects it. */
  live: boolean;
  queued: { versionId: string; activatesAt: string; stillOld: boolean }[];
}

const holds = (copy: DeclarationCopy, values: DeclarationValues | undefined): boolean =>
  values !== undefined &&
  canonicalJson(copy.values) === canonicalJson(declarationsFor(copy.target.kind, values));

/** The copies of `productIds` whose declarations are not `current`'s. */
function differingCopies(
  document: MenuDocument,
  productIds: ReadonlySet<string>,
  current: ReadonlyMap<string, DeclarationValues>,
): DeclarationCopy[] {
  return declarationCopies(document).filter(
    (copy) =>
      productIds.has(copy.productId) &&
      current.has(copy.productId) &&
      !holds(copy, current.get(copy.productId)),
  );
}

/** A dish's change also corrects its variants, so a variant whose dish is corrected adds none. */
function changesFor(copies: readonly DeclarationCopy[]): MenuPatchChange[] {
  const changes = new Map<string, MenuPatchChange>();
  for (const copy of copies) {
    if (copy.dish !== undefined && changes.has(canonicalJson(copy.dish.target))) continue;
    changes.set(canonicalJson(copy.target), {
      target: copy.target,
      field: "declarations",
      value: "product",
    });
  }
  return [...changes.values()];
}

/** Every declarations change `document` needs so each copy of `productIds` matches `current`. */
export function declarationChanges(
  document: MenuDocument,
  productIds: ReadonlySet<string>,
  current: ReadonlyMap<string, DeclarationValues>,
): MenuPatchChange[] {
  return changesFor(differingCopies(document, productIds, current));
}

/** Menus whose live or a queued version disagrees with the products' current declarations, by
 * name. Every menu's live version counts, whether or not it is sold at this hour or in any zone. */
export async function findDeclarationDrift(
  tx: Transaction,
  productIds: readonly string[],
  before: ReadonlyMap<string, DeclarationValues>,
  at: Date = now(),
): Promise<DeclarationDrift[]> {
  const current = await readProductDeclarationValues(tx, productIds);
  return driftFrom(tx, productIds, before, current, at);
}

async function driftFrom(
  tx: Transaction,
  productIds: readonly string[],
  before: ReadonlyMap<string, DeclarationValues>,
  current: ReadonlyMap<string, DeclarationValues>,
  at: Date,
): Promise<DeclarationDrift[]> {
  const ids = new Set(productIds);
  const live = await liveVersions(tx, undefined, "document", at);
  const queuedRows = await tx
    .select({
      menuId: menuReleases.menuId,
      versionId: menuReleases.versionId,
      activatesAt: menuReleases.activatesAt,
      document: menuVersions.document,
    })
    .from(menuReleases)
    .innerJoin(menuVersions, eq(menuVersions.id, menuReleases.versionId))
    .where(and(eq(menuReleases.state, "queued"), gt(menuReleases.activatesAt, at)))
    .orderBy(asc(menuReleases.activatesAt));
  const queued = new Map<string, QueuedDeclarationCorrection[]>();
  for (const { menuId, versionId, activatesAt, document } of queuedRows) {
    const copies = differingCopies(document, ids, current);
    if (copies.length === 0) continue;
    const stillOld = copies.every((copy) => holds(copy, before.get(copy.productId)));
    const changes = changesFor(copies);
    const entry = { versionId, activatesAt: activatesAt.toISOString(), changes, stillOld };
    queued.set(menuId, [...(queued.get(menuId) ?? []), entry]);
  }
  const named = await tx
    .select({ id: menus.id, name: menus.name })
    .from(menus)
    .orderBy(asc(menus.name), asc(menus.id));
  return named.flatMap(({ id, name }): DeclarationDrift[] => {
    const version = live.get(id);
    const changes = version ? declarationChanges(version.document!, ids, current) : [];
    const waiting = queued.get(id) ?? [];
    if (changes.length === 0 && waiting.length === 0) return [];
    return [
      {
        menuId: id,
        name,
        liveVersionId: version?.versionId ?? null,
        live: changes,
        queued: waiting,
      },
    ];
  });
}

/** [] when the products' declarations equal `before`; else every drifting menu. */
export async function waitingDeclarationMenus(
  tx: Transaction,
  productIds: readonly string[],
  before: ReadonlyMap<string, DeclarationValues>,
): Promise<DeclarationMenu[]> {
  const after = await readProductDeclarationValues(tx, productIds);
  const unchanged = productIds.every(
    (id) => canonicalJson(after.get(id) ?? null) === canonicalJson(before.get(id) ?? null),
  );
  if (unchanged) return [];
  return (await driftFrom(tx, productIds, before, after, now())).map(
    ({ menuId, name, live, queued }) => ({
      menuId,
      name,
      live: live.length > 0,
      queued: queued.map(({ versionId, activatesAt, stillOld }) => ({
        versionId,
        activatesAt,
        stillOld,
      })),
    }),
  );
}
