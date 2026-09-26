import { and, eq, inArray, max, sql, type SQL } from "drizzle-orm";
import { now, products, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { batches } from "./batches.js";
import {
  buildMenuDocument,
  buildMenuDocuments,
  diffEntries,
  documentImages,
  menuDocumentHash,
  type DiffEntry,
  type OmittedShortcut,
} from "./menu-document.js";
import { menuPublications, menuVersionImages, menuVersions } from "./schema/publication.js";
import { menusContaining, reachableProducts } from "./section-graph.js";
import type {
  DocumentMember,
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
function statusOf(hash: string, version: LiveVersion | undefined): MenuStatus {
  return version === undefined
    ? { state: "unpublished" }
    : {
        state: hash === version.contentHash ? "current" : "changed",
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
  for (const [menuId, { document }] of menus)
    status.set(menuId, statusOf(menuDocumentHash(document), live.get(menuId)));
  return status;
}

/** Each published menu's live version and its document. */
export async function readLiveDocuments(
  tx: Transaction,
  menuIds: readonly string[],
): Promise<Map<string, { versionId: string; document: MenuDocument }>> {
  const live = new Map<string, { versionId: string; document: MenuDocument }>();
  for (const [menuId, { versionId, document }] of await liveVersions(tx, menuIds, true))
    live.set(menuId, { versionId, document: document! });
  return live;
}

/** Every section id the document's structure holds. */
function sectionsOf(document: MenuDocument): Set<string> {
  const held = new Set<string>();
  const walk = (members: readonly DocumentMember[]): void => {
    for (const member of members)
      if (member.kind === "section") {
        held.add(member.sectionId);
        walk(member.members);
      }
  };
  walk(document.root.members);
  return held;
}

/** The key two menus' changes share when one shared edit made both. */
function changeSubject({ change, section }: DiffEntry): string {
  switch (change.kind) {
    case "product_added":
    case "product_removed":
    case "product_moved":
    case "price_changed":
    case "product_changed":
      return `${change.kind}:${change.productId}`;
    case "section_added":
    case "section_removed":
    case "section_changed":
      return `${change.kind}:${change.sectionId}`;
    default:
      // Only `order_changed` can be shared among the rest, and its section says which list.
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

/**
 * What publishing the menu would change, each change naming its source, the shortcuts the publish
 * would leave out (D13), and the menu's publication state. `hash` is what `publishMenu` must be
 * handed back.
 *
 * A change inside a library section is the shared section's only while another menu reaches that
 * section, in its working structure or its live version. A shared change's `alsoOn` names the
 * other published menus whose own preview holds the same change.
 */
export async function previewMenu(tx: Transaction, menuId: string): Promise<MenuPreview> {
  const { graph, menus, sectionNames } = await buildMenuDocuments(tx, [menuId]);
  const mine = menus.get(menuId);
  if (mine === undefined) throw new AppError("catalogue.not_found", { catalogueId: menuId });
  const own = (await liveVersions(tx, [menuId], true)).get(menuId);
  const entries = diffEntries(own?.document ?? null, mine.document);

  // Every published menu's live version, read only once a change needs another menu.
  let everyLive: Map<string, LiveVersion> | undefined;
  const allLive = async () => (everyLive ??= await liveVersions(tx, undefined, true));
  let liveSections: [string, Set<string>][] | undefined;
  const heldLive = async (sectionId: string, owner: string): Promise<boolean> => {
    liveSections ??= [...(await allLive())].map(([id, { document }]) => [
      id,
      sectionsOf(document!),
    ]);
    return liveSections.some(([other, held]) => other !== owner && held.has(sectionId));
  };
  const containing = new Map<string, string[]>();
  const menusReaching = (sectionId: string): string[] => {
    let found = containing.get(sectionId);
    if (found === undefined) {
      found = menusContaining(graph, sectionId);
      containing.set(sectionId, found);
    }
    return found;
  };

  const inactiveOf = async (lists: readonly DiffEntry[][]): Promise<Set<string>> => {
    const removed = lists.flatMap((list) =>
      list.flatMap(({ change }) => (change.kind === "product_removed" ? [change.productId] : [])),
    );
    const inactive = new Set<string>();
    for (const batch of batches([...new Set(removed)]))
      for (const row of await tx
        .select({ id: products.id })
        .from(products)
        .where(and(inArray(products.id, batch), eq(products.active, false))))
        inactive.add(row.id);
    return inactive;
  };
  const refine = async (
    list: DiffEntry[],
    owner: string,
    rootSectionId: string,
    deleted: ReadonlySet<string>,
  ): Promise<void> => {
    const reached = new Set(reachableProducts(graph, rootSectionId));
    for (const entry of list) {
      const { change } = entry;
      if (change.kind === "product_removed" && reached.has(change.productId)) {
        change.source = deleted.has(change.productId) ? "shared_product" : "this_menu";
        delete entry.section;
      } else if (entry.section !== undefined) {
        const section = entry.section;
        const shared =
          menusReaching(section).some((other) => other !== owner) ||
          (await heldLive(section, owner));
        if (!shared) {
          change.source = "this_menu";
          delete entry.section;
        }
      }
    }
  };
  await refine(entries, menuId, mine.rootSectionId, await inactiveOf([entries]));

  // The other menus are built and compared only to fill in a shared change's `alsoOn`.
  if (entries.some(({ change }) => change.source !== "this_menu")) {
    const live = await allLive();
    const { menus: built } = await buildMenuDocuments(
      tx,
      [...live.keys()].filter((other) => other !== menuId),
      graph,
    );
    const others = [...built]
      .map(([other, { document, rootSectionId }]) => ({
        menuId: other,
        name: document.menuName,
        rootSectionId,
        entries: diffEntries(live.get(other)!.document, document),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const deleted = await inactiveOf(others.map((other) => other.entries));
    for (const other of others)
      await refine(other.entries, other.menuId, other.rootSectionId, deleted);
    for (const entry of entries) {
      if (entry.change.source === "this_menu") continue;
      const alsoOn = others
        .filter((other) => other.entries.some((candidate) => sameEdit(entry, candidate)))
        .map((other) => other.name);
      if (alsoOn.length > 0) entry.change.alsoOn = alsoOn;
    }
  }

  const hash = menuDocumentHash(mine.document);
  return {
    hash,
    changes: entries.map(({ change }) => change),
    warnings: await shortcutWarnings(tx, mine.document, mine.omittedShortcuts, sectionNames),
    status: statusOf(hash, own),
  };
}

/** The omitted shortcuts, named: a section's name is already read, and a product's is read here. */
async function shortcutWarnings(
  tx: Transaction,
  document: MenuDocument,
  omitted: readonly OmittedShortcut[],
  sectionNames: ReadonlyMap<string, string>,
): Promise<{ kind: "shortcut_omitted"; layoutName: string; name: string }[]> {
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
    kind: "shortcut_omitted",
    layoutName: layoutNames.get(layoutId)!,
    name:
      ref.kind === "product" ? productNames.get(ref.productId)! : sectionNames.get(ref.sectionId)!,
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
  const { document } = await buildMenuDocument(tx, menuId);
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
