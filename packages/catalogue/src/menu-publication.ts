import type { CombinedOffer } from "./menu-combine-types.js";
import { and, eq, inArray, max, sql, type SQL } from "drizzle-orm";
import { now, products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { batches } from "./batches.js";
import {
  buildMenuDocument,
  buildMenuDocuments,
  diffEntries,
  documentImages,
  MENU_DOCUMENT_FORMAT,
  menuDocumentHash,
  removedExtraOnlyProducts,
  type DiffEntry,
  type OmittedShortcut,
} from "./menu-document.js";
import { menuPublications, menuVersionImages, menuVersions } from "./schema/publication.js";
import { menusContaining, reachableProducts } from "./section-graph.js";
import type {
  MenuChange,
  MenuDocument,
  MenuPreview,
  MenuStatus,
  PublishedMenuVersion,
} from "./menu-document-types.js";
import "./errors.js";

export type { MenuStatus } from "./menu-document-types.js";

interface LiveVersion {
  versionId: string;
  number: number;
  publishedAt: Date;
  contentHash: string;
  /** Read only when asked for. */
  document: MenuDocument | null;
}

/** The named menus' live versions, or every published menu's when `menuIds` is left out. */
async function liveVersions(
  tx: Transaction,
  menuIds: readonly string[] | undefined,
  withDocument: boolean,
): Promise<Map<string, LiveVersion>> {
  const read = (where?: SQL) =>
    tx
      .select({
        menuId: menuPublications.menuId,
        versionId: menuVersions.id,
        number: menuVersions.number,
        publishedAt: menuVersions.publishedAt,
        contentHash: menuVersions.contentHash,
        document: withDocument ? menuVersions.document : sql<null>`null`,
      })
      .from(menuPublications)
      .innerJoin(menuVersions, eq(menuVersions.id, menuPublications.versionId))
      .where(where);
  const rows = [];
  if (menuIds === undefined) rows.push(...(await read()));
  else
    for (const batch of batches(menuIds))
      rows.push(...(await read(inArray(menuPublications.menuId, batch))));
  return new Map(rows.map(({ menuId, ...version }) => [menuId, version]));
}

/** `hash` is the working document's. */
function statusOf(hash: string, version: LiveVersion | undefined, clashes = 0): MenuStatus {
  return version === undefined
    ? { state: "unpublished", clashes }
    : {
        state: hash === version.contentHash ? "current" : "changed",
        clashes,
        version: version.number,
        publishedAt: version.publishedAt.toISOString(),
        hash: version.contentHash,
      };
}

/**
 * Each menu's publication state, or every menu's when `menuIds` is left out. Every menu's document
 * is built in one pass, because the menu list asks again on every live change. An id that names no
 * menu is left out.
 */
export async function menuStatus(
  tx: Transaction,
  menuIds?: readonly string[],
): Promise<Map<string, MenuStatus>> {
  const status = new Map<string, MenuStatus>();
  if (menuIds?.length === 0) return status;
  const { menus } = await buildMenuDocuments(tx, menuIds);
  const live = await liveVersions(tx, menuIds, false);
  for (const [menuId, { document, clashes }] of menus)
    status.set(menuId, statusOf(menuDocumentHash(document), live.get(menuId), clashes.length));
  return status;
}

/** Parsed documents a database handle has read, by version id: at most this many per handle. */
const CACHED_DOCUMENTS = 32;

interface CachedDocument {
  contentHash: string;
  document: MenuDocument;
}

const documentCaches = new WeakMap<Transaction, Map<string, CachedDocument>>();

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * Each published menu's live version and its document. A version in an earlier document format,
 * which holds no VAT classes, is left out, as a menu with no live version is. A version's row is never
 * changed once written (`menu_versions` is `appendOnly()`), so each handle keeps the parsed documents
 * it has read, frozen, and reads a document again only when it is not kept or its row's content hash
 * differs from the kept one.
 */
export async function readLiveDocuments(
  tx: Transaction,
  menuIds: readonly string[],
): Promise<Map<string, { versionId: string; document: MenuDocument }>> {
  const versions = await liveVersions(tx, menuIds, false);
  let cache = documentCaches.get(tx);
  if (cache === undefined) documentCaches.set(tx, (cache = new Map()));
  const found = new Map<string, MenuDocument>();
  const missing: string[] = [];
  for (const { versionId, contentHash } of versions.values()) {
    const kept = cache.get(versionId);
    if (kept?.contentHash === contentHash) {
      cache.delete(versionId);
      cache.set(versionId, kept);
      found.set(versionId, kept.document);
    } else missing.push(versionId);
  }
  for (const batch of batches(missing))
    for (const row of await tx
      .select({
        id: menuVersions.id,
        contentHash: menuVersions.contentHash,
        document: menuVersions.document,
      })
      .from(menuVersions)
      .where(inArray(menuVersions.id, batch))) {
      const document = deepFreeze(row.document);
      found.set(row.id, document);
      cache.delete(row.id);
      cache.set(row.id, { contentHash: row.contentHash, document });
    }
  for (const versionId of cache.keys()) {
    if (cache.size <= CACHED_DOCUMENTS) break;
    cache.delete(versionId);
  }
  const live = new Map<string, { versionId: string; document: MenuDocument }>();
  for (const [menuId, { versionId }] of versions) {
    const document = found.get(versionId)!;
    if (document.format === MENU_DOCUMENT_FORMAT) live.set(menuId, { versionId, document });
  }
  return live;
}

/**
 * The allowed menus' live versions and documents, as {@link readLiveDocuments} answers them, once
 * every asserted version is the live version of an allowed menu. Otherwise refused with
 * `menu.version_changed`, naming each such menu once.
 */
export async function assertLiveVersions(
  tx: Transaction,
  allowedMenuIds: readonly string[],
  asserted: readonly { menuId: string; versionId: string }[],
): Promise<Map<string, { versionId: string; document: MenuDocument }>> {
  const live = await readLiveDocuments(tx, allowedMenuIds);
  const changed = new Map<string, string | null>();
  for (const { menuId, versionId } of asserted) {
    const liveVersionId = live.get(menuId)?.versionId ?? null;
    if (liveVersionId !== versionId) changed.set(menuId, liveVersionId);
  }
  if (changed.size > 0)
    throw new AppError("menu.version_changed", {
      menus: [...changed].map(([menuId, liveVersionId]) => ({ menuId, liveVersionId })),
    });
  return live;
}

/** The menu each version belongs to, by version id; an id that names no version is left out. */
export async function menusOfVersions(
  tx: Transaction,
  versionIds: readonly string[],
): Promise<Map<string, string>> {
  const menus = new Map<string, string>();
  for (const batch of batches(versionIds))
    for (const row of await tx
      .select({ versionId: menuVersions.id, menuId: menuVersions.menuId })
      .from(menuVersions)
      .where(inArray(menuVersions.id, batch)))
      menus.set(row.versionId, row.menuId);
  return menus;
}

/** The key two menus' changes share when one shared edit made both. */
function changeSubject({ change, section }: DiffEntry): string {
  switch (change.kind) {
    case "product_added":
    case "product_removed":
    case "product_deleted":
    case "product_moved":
    case "price_changed":
    case "product_changed":
      return `${change.kind}:${change.productId}`;
    case "extra_unit_changed":
    case "extra_portion_changed":
    case "extra_max_quantity_changed":
      return `${change.kind}:${change.listId}:${change.productId}`;
    case "section_added":
    case "section_removed":
    case "section_changed":
      return `${change.kind}:${change.sectionId}`;
    default:
      return `${change.kind}:${section}`;
  }
}

function fieldsOf(change: MenuChange): readonly string[] | undefined {
  return change.kind === "product_changed" || change.kind === "section_changed"
    ? change.fields
    : undefined;
}

/** One shared edit shows up in two menus as the same change from the same source. */
function sameEdit(a: DiffEntry, b: DiffEntry): boolean {
  if (a.change.source !== b.change.source || changeSubject(a) !== changeSubject(b)) return false;
  const fields = fieldsOf(a.change);
  return fields === undefined || fields.some((field) => fieldsOf(b.change)!.includes(field));
}

export async function previewMenu(tx: Transaction, menuId: string): Promise<MenuPreview> {
  const { graph, menus, sectionNames } = await buildMenuDocuments(tx, [menuId]);
  const mine = menus.get(menuId);
  if (mine === undefined) throw new AppError("catalogue.not_found", { catalogueId: menuId });
  const own = (await liveVersions(tx, [menuId], true)).get(menuId);
  const entries = diffEntries(own?.document ?? null, mine.document, mine.combined);
  const removedExtras = removedExtraOnlyProducts(own?.document ?? null, mine.document);

  // Every published menu's live version, read only once a change needs another menu.
  let everyLive: Map<string, LiveVersion> | undefined;
  const allLive = async () => (everyLive ??= await liveVersions(tx, undefined, true));

  const inactiveOf = async (
    lists: readonly DiffEntry[][],
    extraProductIds: readonly string[] = [],
  ): Promise<Set<string>> => {
    const removed = lists.flatMap((list) =>
      list.flatMap(({ change }) => (change.kind === "product_removed" ? [change.productId] : [])),
    );
    const inactive = new Set<string>();
    for (const batch of batches([...new Set([...removed, ...extraProductIds])]))
      for (const row of await tx
        .select({ id: products.id })
        .from(products)
        .where(and(inArray(products.id, batch), eq(products.active, false))))
        inactive.add(row.id);
    return inactive;
  };
  const appendDeletedExtras = (
    list: DiffEntry[],
    removed: readonly { productId: string; name: string }[],
    inactive: ReadonlySet<string>,
  ): void => {
    for (const { productId, name } of removed)
      if (inactive.has(productId))
        list.push({
          change: { kind: "product_deleted", productId, name, source: "shared_product" },
        });
  };
  const refine = async (
    list: DiffEntry[],
    rootSectionId: string,
    deleted: ReadonlySet<string>,
    combined: ReadonlyMap<string, CombinedOffer>,
  ): Promise<void> => {
    const reached = new Set(reachableProducts(graph, rootSectionId));
    for (const entry of list) {
      const { change } = entry;
      if (change.kind === "product_removed" && reached.has(change.productId)) {
        const decision = combined.get(change.productId)?.offered;
        if (
          !deleted.has(change.productId) &&
          decision?.state === "decided" &&
          decision.source.kind === "menu"
        ) {
          change.source = "included_menu";
          change.includedMenu = { id: decision.source.menuId, name: decision.source.menuName };
        } else {
          change.source = deleted.has(change.productId) ? "shared_product" : "this_menu";
          delete change.includedMenu;
        }
        delete entry.section;
      }
    }
  };
  const deleted = await inactiveOf(
    [entries],
    removedExtras.map(({ productId }) => productId),
  );
  appendDeletedExtras(entries, removedExtras, deleted);
  await refine(entries, mine.rootSectionId, deleted, mine.combined);

  // The other menus are built and compared only to fill in a shared change's `alsoOn`.
  if (
    entries.length > 0 &&
    (entries.some(({ change }) => change.source !== "this_menu") ||
      menusContaining(graph, mine.rootSectionId).some((id) => id !== menuId))
  ) {
    const live = await allLive();
    const { menus: built } = await buildMenuDocuments(
      tx,
      [...live.keys()].filter((other) => other !== menuId),
      graph,
    );
    const others = [...built]
      .map(([other, { document, rootSectionId, combined }]) => ({
        menuId: other,
        name: document.menuName,
        rootSectionId,
        combined,
        entries: diffEntries(live.get(other)!.document, document, combined),
        removedExtras: removedExtraOnlyProducts(live.get(other)!.document, document),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const deleted = await inactiveOf(
      others.map((other) => other.entries),
      others.flatMap((other) => other.removedExtras.map(({ productId }) => productId)),
    );
    for (const other of others) {
      appendDeletedExtras(other.entries, other.removedExtras, deleted);
      await refine(other.entries, other.rootSectionId, deleted, other.combined);
    }
    for (const entry of entries) {
      const alsoOn = others
        .filter(
          (other) =>
            (entry.change.source === "this_menu" &&
              menusContaining(graph, mine.rootSectionId).includes(other.menuId) &&
              menuDocumentHash(built.get(other.menuId)!.document) !==
                live.get(other.menuId)!.contentHash) ||
            other.entries.some(
              (candidate) =>
                sameEdit(entry, candidate) ||
                (entry.change.source === "this_menu" &&
                  candidate.change.includedMenu?.id === menuId &&
                  changeSubject(entry) === changeSubject(candidate)),
            ),
        )
        .map((other) => other.name);
      if (alsoOn.length > 0) entry.change.alsoOn = alsoOn;
    }
  }

  const hash = menuDocumentHash(mine.document);
  const precisionWarnings: MenuPreview["warnings"] = [];
  const warned = new Set<string>();
  for (const offer of Object.values(mine.document.offers))
    for (const list of offer.offeredModifiers) {
      if (list.kind !== "extras") continue;
      for (const item of list.items) {
        const key = `${list.id}:${item.productId}`;
        if (warned.has(key)) continue;
        warned.add(key);
        const portion = item.portion ?? "1.000";
        const significantPlaces = (portion.split(".")[1] ?? "").replace(/0+$/, "").length;
        if (significantPlaces <= (item.unit?.precision ?? 0)) continue;
        precisionWarnings.push({
          kind: "extra_portion_precision",
          listName: list.name,
          name: item.name,
          portion,
          abbreviation: item.unit?.abbreviation ?? {},
          precision: item.unit?.precision ?? 0,
        });
      }
    }
  return {
    hash,
    clashes: mine.clashes,
    changes: entries.map(({ change }) => change),
    warnings: [
      ...(await shortcutWarnings(tx, mine.document, mine.omittedShortcuts, sectionNames)),
      ...precisionWarnings,
    ],
    status: statusOf(hash, own, mine.clashes.length),
    document: mine.document,
  };
}

async function shortcutWarnings(
  tx: Transaction,
  document: MenuDocument,
  omitted: readonly OmittedShortcut[],
  sectionNames: ReadonlyMap<string, string>,
): Promise<{ kind: "shortcut_missing"; layoutName: string; name: string }[]> {
  const productIds = omitted.flatMap(({ ref }) => (ref.kind === "product" ? [ref.productId] : []));
  const productNames = new Map<string, string>();
  for (const batch of batches(productIds))
    for (const row of await tx
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(inArray(products.id, batch)))
      productNames.set(row.id, row.name);
  const layoutNames = new Map(document.homeLayouts.map((layout) => [layout.id, layout.name]));
  return omitted.map(({ layoutId, ref }) => ({
    kind: "shortcut_missing",
    layoutName: layoutNames.get(layoutId)!,
    name:
      ref.kind === "missing"
        ? ref.name
        : ref.kind === "product"
          ? productNames.get(ref.productId)!
          : sectionNames.get(ref.sectionId)!,
  }));
}

/**
 * Makes the menu's working state its live version, inside the caller's one transaction: the
 * document is rebuilt here, and refused with `menu.changed_since_preview` unless it hashes to what
 * the preview showed. Publishing a menu that already matches its live version writes nothing.
 */
export async function publishMenu(
  tx: Transaction,
  menuId: string,
  expectedHash: string,
  personId: string,
): Promise<PublishedMenuVersion> {
  const { document, clashes } = await buildMenuDocument(tx, menuId);
  if (clashes.length > 0)
    throw new AppError("menu.clashes_unresolved", { menuId, count: clashes.length });
  const contentHash = menuDocumentHash(document);
  if (contentHash !== expectedHash) throw new AppError("menu.changed_since_preview", { menuId });
  const current = (await liveVersions(tx, [menuId], false)).get(menuId);
  if (current?.contentHash === contentHash)
    return { versionId: current.versionId, number: current.number };
  const [latest] = await tx
    .select({ number: max(menuVersions.number) })
    .from(menuVersions)
    .where(eq(menuVersions.menuId, menuId));
  const number = (latest?.number ?? 0) + 1;
  const publishedAt = now();
  const [version] = await tx
    .insert(menuVersions)
    .values({ menuId, number, document, contentHash, publishedAt, publishedBy: personId })
    .returning({ id: menuVersions.id });
  const versionId = version!.id;
  for (const batch of batches(documentImages(document)))
    await tx.insert(menuVersionImages).values(batch.map((filename) => ({ versionId, filename })));
  await tx
    .insert(menuPublications)
    .values({ menuId, versionId, publishedAt })
    .onConflictDoUpdate({ target: menuPublications.menuId, set: { versionId, publishedAt } });
  return { versionId, number };
}
