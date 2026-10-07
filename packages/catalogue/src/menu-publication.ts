import { navigateMenuChanges } from "./menu-navigation.js";
import { and, asc, eq, gt, gte, inArray, lt, lte, max, or, sql } from "drizzle-orm";
import { now, products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { BATCH_SIZE, batches } from "./batches.js";
import { alias, unionAll } from "drizzle-orm/sqlite-core";
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
import {
  menuPublications,
  menuScheduledPublications,
  menuVersionImages,
  menuVersions,
} from "./schema/publication.js";
import { menusContaining, reachableProducts } from "./section-graph.js";
import type {
  MenuChangeBody,
  MenuDocument,
  MenuPreview,
  MenuStatus,
  OvertakenEdition,
  PublishedMenuVersion,
} from "./menu-document-types.js";
import "./errors.js";

export type { MenuStatus } from "./menu-document-types.js";

export interface LiveVersion {
  versionId: string;
  number: number;
  /** When it became live: the pointer's `published_at`, or a due queued edition's `activates_at`. */
  since: Date;
  contentHash: string;
  document: MenuDocument | null;
}

/** Every queued edition due at `at`, ranked per menu by number (rank 1 is the highest). */
function dueEditions(tx: Transaction, at: Date, menuIds?: readonly string[]) {
  return tx
    .select({
      menuId: menuScheduledPublications.menuId,
      versionId: menuScheduledPublications.versionId,
      activatesAt: menuScheduledPublications.activatesAt,
      rank: sql<number>`row_number() over (partition by ${menuScheduledPublications.menuId} order by ${menuVersions.number} desc)`.as(
        "rank",
      ),
    })
    .from(menuScheduledPublications)
    .innerJoin(menuVersions, eq(menuVersions.id, menuScheduledPublications.versionId))
    .where(
      and(
        sql`${menuScheduledPublications.state} = 'queued'`,
        lte(menuScheduledPublications.activatesAt, at),
        menuIds === undefined ? undefined : inArray(menuScheduledPublications.menuId, menuIds),
      ),
    )
    .as("due");
}

/**
 * The named menus' versions live at `at`, or every published menu's when `menuIds` is left out:
 * the pointer's, or the highest-numbered queued edition due by then when that number is higher.
 */
export async function liveVersions(
  tx: Transaction,
  menuIds: readonly string[] | undefined,
  mode: "metadata" | "format" | "document",
  at: Date = now(),
): Promise<Map<string, LiveVersion>> {
  const content = {
    versionId: menuVersions.id,
    number: menuVersions.number,
    contentHash: menuVersions.contentHash,
    document: mode === "document" ? menuVersions.document : sql<null>`null`,
    format:
      mode === "format"
        ? sql<unknown>`json_extract(${menuVersions.document}, '$.format')`
        : sql<null>`null`,
  };
  const read = (batch?: readonly string[]) => {
    const due = dueEditions(tx, at, batch);
    return unionAll(
      tx
        .select({
          menuId: menuPublications.menuId,
          since: menuPublications.publishedAt,
          ...content,
        })
        .from(menuPublications)
        .innerJoin(menuVersions, eq(menuVersions.id, menuPublications.versionId))
        .where(batch === undefined ? undefined : inArray(menuPublications.menuId, batch)),
      tx
        .select({ menuId: due.menuId, since: due.activatesAt, ...content })
        .from(due)
        .innerJoin(menuVersions, eq(menuVersions.id, due.versionId))
        .where(sql`${due.rank} = 1`),
    );
  };
  const rows = [];
  // Both halves name the batch's ids, and the instant is bound once more.
  for (const batch of menuIds === undefined ? [undefined] : batches(menuIds, BATCH_SIZE / 2 - 1))
    rows.push(...(await read(batch)));
  const chosen = new Map<string, (typeof rows)[number]>();
  for (const row of rows)
    if ((chosen.get(row.menuId)?.number ?? 0) < row.number) chosen.set(row.menuId, row);
  const live = new Map<string, LiveVersion>();
  for (const [menuId, { versionId, number, since, contentHash, document, format }] of chosen) {
    if (mode === "document") requireCurrentFormat(menuId, document!.format);
    else if (mode === "format") requireCurrentFormat(menuId, format);
    live.set(menuId, { versionId, number, since, contentHash, document });
  }
  return live;
}

/**
 * Marks every queued edition due at `at` activated, and moves each menu's pointer to its
 * highest-numbered due edition, as of that edition's own time, unless the pointer already holds a
 * higher number. Answers the pointers it moved.
 */
export async function settleDue(
  tx: Transaction,
  at: Date,
  menuIds?: readonly string[],
): Promise<{ menuId: string; versionId: string; number: number }[]> {
  const current = alias(menuVersions, "current");
  const read = (batch?: readonly string[]) => {
    const due = dueEditions(tx, at, batch);
    return tx
      .select({
        menuId: due.menuId,
        versionId: due.versionId,
        activatesAt: due.activatesAt,
        number: menuVersions.number,
        liveNumber: current.number,
      })
      .from(due)
      .innerJoin(menuVersions, eq(menuVersions.id, due.versionId))
      .leftJoin(menuPublications, eq(menuPublications.menuId, due.menuId))
      .leftJoin(current, eq(current.id, menuPublications.versionId))
      .where(sql`${due.rank} = 1`);
  };
  // The instant and the state are bound beside the batch's ids.
  const groups = menuIds === undefined ? [undefined] : batches(menuIds, BATCH_SIZE - 2);
  const candidates = [];
  for (const batch of groups) candidates.push(...(await read(batch)));
  if (candidates.length === 0) return [];
  for (const batch of groups)
    await tx
      .update(menuScheduledPublications)
      .set({ state: "activated", activatedAt: at })
      .where(
        and(
          eq(menuScheduledPublications.state, "queued"),
          lte(menuScheduledPublications.activatesAt, at),
          batch === undefined ? undefined : inArray(menuScheduledPublications.menuId, batch),
        ),
      );
  const moved = [];
  for (const { menuId, versionId, number, activatesAt, liveNumber } of candidates) {
    if (liveNumber !== null && liveNumber >= number) continue;
    await tx
      .insert(menuPublications)
      .values({ menuId, versionId, publishedAt: activatesAt })
      .onConflictDoUpdate({
        target: menuPublications.menuId,
        set: { versionId, publishedAt: activatesAt },
      });
    moved.push({ menuId, versionId, number });
  }
  return moved;
}

function requireCurrentFormat(menuId: string, format: unknown): void {
  if (format !== MENU_DOCUMENT_FORMAT) throw new AppError("menu.reset_required", { menuId });
}

/** `hash` is the working document's. */
function statusOf(hash: string, version: LiveVersion | undefined, clashes = 0): MenuStatus {
  return version === undefined
    ? { state: "unpublished", clashes }
    : {
        state: hash === version.contentHash ? "current" : "changed",
        clashes,
        version: version.number,
        publishedAt: version.since.toISOString(),
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
  const live = await liveVersions(tx, menuIds, "format");
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
 * Each published menu's version live at this instant and its document. Unsupported formats require
 * a venue reset. A version's row is never changed once written (`menu_versions` is `appendOnly()`),
 * so each handle keeps the parsed documents it has read, frozen, and reads a document again only
 * when it is not kept or its row's content hash differs from the kept one.
 */
export async function readLiveDocuments(
  tx: Transaction,
  menuIds: readonly string[],
): Promise<Map<string, { versionId: string; document: MenuDocument }>> {
  const versions = await liveVersions(tx, menuIds, "metadata");
  let cache = documentCaches.get(tx);
  if (cache === undefined) documentCaches.set(tx, (cache = new Map()));
  const found = new Map<string, MenuDocument>();
  const missing: string[] = [];
  const menuOfVersion = new Map(
    [...versions].map(([menuId, { versionId }]) => [versionId, menuId]),
  );
  for (const { versionId, contentHash } of versions.values()) {
    const kept = cache.get(versionId);
    if (kept?.contentHash === contentHash) {
      // A cache hit reuses the frozen document validated on its first read.
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
      requireCurrentFormat(menuOfVersion.get(row.id)!, row.document.format);
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
    live.set(menuId, { versionId, document });
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

function fieldsOf(change: MenuChangeBody): readonly string[] | undefined {
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
  const own = (await liveVersions(tx, [menuId], "document")).get(menuId);
  const ownDocument = own?.document ?? null;
  const entries = diffEntries(ownDocument, mine.document, mine.combined);
  const removedExtras = removedExtraOnlyProducts(ownDocument, mine.document);

  let everyLive: Map<string, LiveVersion> | undefined;
  const allLive = async () => (everyLive ??= await liveVersions(tx, undefined, "document"));

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
  ): Promise<void> => {
    const reached = new Set(reachableProducts(graph, rootSectionId));
    for (const entry of list) {
      const { change } = entry;
      if (change.kind === "product_removed" && reached.has(change.productId)) {
        change.source = deleted.has(change.productId) ? "shared_product" : "this_menu";
        delete change.includedMenu;
        delete entry.section;
      }
    }
  };
  const deleted = await inactiveOf(
    [entries],
    removedExtras.map(({ productId }) => productId),
  );
  appendDeletedExtras(entries, removedExtras, deleted);
  await refine(entries, mine.rootSectionId, deleted);

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
      await refine(other.entries, other.rootSectionId, deleted);
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
    changes: navigateMenuChanges(
      ownDocument,
      mine.document,
      entries.map(({ change }) => change),
    ),
    warnings: [
      ...(await shortcutWarnings(tx, mine.omittedShortcuts, sectionNames)),
      ...precisionWarnings,
    ],
    status: statusOf(hash, own, mine.clashes.length),
    document: mine.document,
    live: ownDocument === null ? null : { versionId: own!.versionId, document: ownDocument },
  };
}

async function shortcutWarnings(
  tx: Transaction,
  omitted: readonly OmittedShortcut[],
  sectionNames: ReadonlyMap<string, string>,
): Promise<{ kind: "shortcut_missing"; name: string }[]> {
  const productIds = omitted.flatMap(({ ref }) => (ref.kind === "product" ? [ref.productId] : []));
  const productNames = new Map<string, string>();
  for (const batch of batches(productIds))
    for (const row of await tx
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(inArray(products.id, batch)))
      productNames.set(row.id, row.name);
  return omitted.map(({ ref }) => ({
    kind: "shortcut_missing",
    name:
      ref.kind === "missing"
        ? ref.name
        : ref.kind === "product"
          ? productNames.get(ref.productId)!
          : sectionNames.get(ref.sectionId)!,
  }));
}

/** The number the menu's next edition takes: one past every version it has, cancelled ones too. */
export async function nextNumber(tx: Transaction, menuId: string): Promise<number> {
  const [latest] = await tx
    .select({ number: max(menuVersions.number) })
    .from(menuVersions)
    .where(eq(menuVersions.menuId, menuId));
  return (latest?.number ?? 0) + 1;
}

/**
 * The queued editions that an edition numbered `number` placed at `activatesAt` would overtake,
 * ascending by number: a lower number activating no earlier, or a higher one no later. Equal
 * instants count, because the higher number would hide the lower one for ever. The edition being
 * placed, passed with its own number, matches neither clause.
 */
export async function overtakenBy(
  tx: Transaction,
  menuId: string,
  number: number,
  activatesAt: Date,
): Promise<OvertakenEdition[]> {
  const rows = await tx
    .select({
      versionId: menuScheduledPublications.versionId,
      number: menuVersions.number,
      activatesAt: menuScheduledPublications.activatesAt,
    })
    .from(menuScheduledPublications)
    .innerJoin(menuVersions, eq(menuVersions.id, menuScheduledPublications.versionId))
    .where(
      and(
        eq(menuScheduledPublications.menuId, menuId),
        eq(menuScheduledPublications.state, "queued"),
        or(
          and(
            lt(menuVersions.number, number),
            gte(menuScheduledPublications.activatesAt, activatesAt),
          ),
          and(
            gt(menuVersions.number, number),
            lte(menuScheduledPublications.activatesAt, activatesAt),
          ),
        ),
      ),
    )
    .orderBy(asc(menuVersions.number));
  return rows.map((row) => ({ ...row, activatesAt: row.activatesAt.toISOString() }));
}

/** Refuses `menu_publication.overtakes_queued` when `overtaken` names any edition. */
export function refuseOvertaken(menuId: string, overtaken: readonly OvertakenEdition[]): void {
  if (overtaken.length > 0)
    throw new AppError("menu_publication.overtakes_queued", { menuId, overtaken: [...overtaken] });
}

/**
 * Makes the menu's working state its live version, inside the caller's one transaction: the
 * document is rebuilt here, and refused with `menu.changed_since_preview` unless it hashes to what
 * the preview showed. The menu's due queued editions are settled first. Publishing a menu that
 * then matches its live version writes nothing more; otherwise a queued edition the publish would
 * overtake refuses it.
 */
export async function publishMenu(
  tx: Transaction,
  menuId: string,
  expectedHash: string,
  personId: string,
  options: { at?: Date } = {},
): Promise<PublishedMenuVersion> {
  const publishedAt = options.at ?? now();
  await settleDue(tx, publishedAt, [menuId]);
  const { document, clashes } = await buildMenuDocument(tx, menuId);
  if (clashes.length > 0)
    throw new AppError("menu.clashes_unresolved", { menuId, count: clashes.length });
  const contentHash = menuDocumentHash(document);
  if (contentHash !== expectedHash) throw new AppError("menu.changed_since_preview", { menuId });
  const current = (await liveVersions(tx, [menuId], "format", publishedAt)).get(menuId);
  if (current?.contentHash === contentHash)
    return { versionId: current.versionId, number: current.number };
  const number = await nextNumber(tx, menuId);
  refuseOvertaken(menuId, await overtakenBy(tx, menuId, number, publishedAt));
  const versionId = await insertVersion(tx, {
    menuId,
    number,
    document,
    contentHash,
    publishedAt,
    publishedBy: personId,
  });
  await tx
    .insert(menuPublications)
    .values({ menuId, versionId, publishedAt })
    .onConflictDoUpdate({ target: menuPublications.menuId, set: { versionId, publishedAt } });
  return { versionId, number };
}

/** Writes a version and the photos its document names; both rows are never changed again. */
export async function insertVersion(
  tx: Transaction,
  version: typeof menuVersions.$inferInsert,
): Promise<string> {
  const [row] = await tx.insert(menuVersions).values(version).returning({ id: menuVersions.id });
  const versionId = row!.id;
  for (const batch of batches(documentImages(version.document)))
    await tx.insert(menuVersionImages).values(batch.map((filename) => ({ versionId, filename })));
  return versionId;
}
