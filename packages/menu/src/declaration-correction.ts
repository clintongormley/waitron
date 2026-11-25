import { and, asc, eq, gt } from "drizzle-orm";
import { menuReleases, menus, menuVersions, now, type Transaction } from "@waitron/db";
import { AppError, type MenuDocument } from "@waitron/shared";
import type { DeclarationValues } from "./declaration-values.js";
import { canonicalJson } from "./menu-document.js";
import { declarationsFor } from "./menu-patch.js";
import { declarationCopies, type DeclarationCopy } from "./menu-patch-declarations.js";
import type { MenuPatchChange } from "./menu-patch-types.js";
import {
  correctQueuedVersions,
  liveVersions,
  patchLiveMenu,
  readRecordedDocuments,
} from "./menu-publication.js";
import { readProductDeclarationValues } from "./product-declarations.js";
import { declarationsInDocument, type PublishedLine } from "./published-declarations.js";
import { listProductVariants } from "./variants.js";
import "./errors.js";

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
  /** The live version disagrees, so the correction route corrects it. */
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
  return (await driftFrom(tx, productIds, before, current, at)).map(
    ({ menuId, name, liveVersionId, live, queued }) => ({
      menuId,
      name,
      liveVersionId,
      live,
      queued: queued.map(({ versionId, activatesAt, changes, stillOld }) => ({
        versionId,
        activatesAt,
        changes,
        stillOld,
      })),
    }),
  );
}

/** A drift with the documents its changes apply to. */
interface DocumentedDrift extends DeclarationDrift {
  queued: (QueuedDeclarationCorrection & { document: MenuDocument })[];
}

async function driftFrom(
  tx: Transaction,
  productIds: readonly string[],
  before: ReadonlyMap<string, DeclarationValues>,
  current: ReadonlyMap<string, DeclarationValues>,
  at: Date,
): Promise<DocumentedDrift[]> {
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
  const queued = new Map<string, DocumentedDrift["queued"]>();
  for (const { menuId, versionId, activatesAt, document } of queuedRows) {
    const copies = differingCopies(document, ids, current);
    if (copies.length === 0) continue;
    const stillOld = copies.every((copy) => holds(copy, before.get(copy.productId)));
    const changes = changesFor(copies);
    const entry = {
      versionId,
      activatesAt: activatesAt.toISOString(),
      changes,
      stillOld,
      document,
    };
    queued.set(menuId, [...(queued.get(menuId) ?? []), entry]);
  }
  const named = await tx
    .select({ id: menus.id, name: menus.name })
    .from(menus)
    .orderBy(asc(menus.name), asc(menus.id));
  return named.flatMap(({ id, name }): DocumentedDrift[] => {
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

/** A menu whose live version a request replaced with `versionId`, and the products whose copies in
 * it now hold other declarations. */
export interface LiveDeclarationChange {
  menuId: string;
  baseVersionId: string;
  versionId: string;
  productIds: string[];
}

/** Each place's copies' declarations, by the target a patch names it with. */
function valuesByPlace(document: MenuDocument): Map<string, { productId: string; values: string }> {
  const byPlace = new Map<string, { productId: string; values: string }>();
  for (const copy of declarationCopies(document)) {
    const place = canonicalJson(copy.target);
    const values = canonicalJson(copy.values);
    const seen = byPlace.get(place);
    byPlace.set(place, {
      productId: copy.productId,
      values: seen === undefined ? values : `${seen.values}\n${values}`,
    });
  }
  return byPlace;
}

/** The products with a copy in `after` whose place held other declarations in `before`, or none. */
function changedDeclarationProducts(before: MenuDocument, after: MenuDocument): string[] {
  const old = valuesByPlace(before);
  const changed = new Set<string>();
  for (const [place, { productId, values }] of valuesByPlace(after))
    if (old.get(place)?.values !== values) changed.add(productId);
  return [...changed];
}

/** `[]` when `versionId` is `baseVersionId` or no copy's declarations changed between them. */
export async function replacedLiveDeclarations(
  tx: Transaction,
  menuId: string,
  baseVersionId: string,
  versionId: string,
): Promise<LiveDeclarationChange[]> {
  if (versionId === baseVersionId) return [];
  const documents = await readRecordedDocuments(tx, [baseVersionId, versionId]);
  const productIds = changedDeclarationProducts(
    documents.get(baseVersionId)!,
    documents.get(versionId)!,
  );
  return productIds.length === 0 ? [] : [{ menuId, baseVersionId, versionId, productIds }];
}

/**
 * The ids of `lines`, each taken from a version of `change`'s menu, that read other declarations
 * since the change. Its new version outnumbers every version of the menu ever live, so a line it
 * holds reads it, and a line it does not hold reads an older version the change left alone.
 */
export async function linesReadingChange(
  tx: Transaction,
  change: LiveDeclarationChange,
  lines: readonly PublishedLine[],
): Promise<string[]> {
  const documents = await readRecordedDocuments(tx, [change.baseVersionId, change.versionId]);
  const before = documents.get(change.baseVersionId)!;
  const after = documents.get(change.versionId)!;
  return lines.flatMap((line) => {
    const now = declarationsInDocument(after, line);
    return now !== undefined &&
      canonicalJson(now) !== canonicalJson(declarationsInDocument(before, line) ?? null)
      ? [line.id]
      : [];
  });
}

/**
 * Puts the product's and its variants' current declarations on every drifting live version, and on
 * each queued version named in `queued`, in the caller's transaction. A named queued version takes
 * the changes its own document needs, including at copies the live version lacks. Versions already
 * agreeing, and queued ones not named, keep their documents. `menus` lists only the menus it
 * changed; `liveChanges` only the live versions it replaced, since a queued version is not what a
 * kitchen reads until it starts. Refuses an id that is neither a product nor a variant.
 */
export async function correctMenuDeclarations(
  tx: Transaction,
  productId: string,
  personId: string,
  options: { at?: Date; fallbackLanguage?: string; queued?: readonly string[] } = {},
): Promise<{ menus: { menuId: string; name: string }[]; liveChanges: LiveDeclarationChange[] }> {
  const at = options.at ?? now();
  const family = [productId, ...(await listProductVariants(tx, productId)).map(({ id }) => id)];
  const current = await readProductDeclarationValues(tx, family);
  if (!current.has(productId)) throw new AppError("product.not_found", { productId });
  const drift = await driftFrom(tx, family, new Map(), current, at);
  const named = new Set(options.queued);
  const menus: { menuId: string; name: string }[] = [];
  const liveChanges: LiveDeclarationChange[] = [];
  const write = { at, fallbackLanguage: options.fallbackLanguage };
  for (const { menuId, name, liveVersionId, live, queued } of drift) {
    const own = queued.filter(({ versionId }) => named.has(versionId));
    if (live.length === 0 && own.length === 0) continue;
    const queuedOwn = new Map(own.map(({ versionId, changes }) => [versionId, changes]));
    if (live.length > 0) {
      const { versionId } = await patchLiveMenu(tx, menuId, liveVersionId!, live, personId, {
        ...write,
        queued: [...queuedOwn.keys()],
        queuedOwn,
      });
      liveChanges.push(...(await replacedLiveDeclarations(tx, menuId, liveVersionId!, versionId)));
    } else await correctQueuedVersions(tx, menuId, queuedOwn, personId, write);
    menus.push({ menuId, name });
  }
  return { menus, liveChanges };
}
