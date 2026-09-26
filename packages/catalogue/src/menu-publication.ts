import { and, eq, inArray, max } from "drizzle-orm";
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
import { menuDetails } from "./schema/menu.js";
import { menuPublications, menuVersionImages, menuVersions } from "./schema/publication.js";
import { sections } from "./schema/sections.js";
import { menusContaining, reachableProducts } from "./section-graph.js";
import type {
  DocumentMember,
  MenuChange,
  MenuDocument,
  MenuStatus,
} from "./menu-document-types.js";
import type { MemberRef } from "./section-types.js";
import "./errors.js";

export type { MenuStatus } from "./menu-document-types.js";

interface LiveVersion {
  versionId: string;
  number: number;
  publishedAt: Date;
  contentHash: string;
}

async function liveVersions(
  tx: Transaction,
  menuIds: readonly string[],
): Promise<Map<string, LiveVersion>> {
  const live = new Map<string, LiveVersion>();
  for (const batch of batches(menuIds))
    for (const row of await tx
      .select({
        menuId: menuPublications.menuId,
        versionId: menuVersions.id,
        number: menuVersions.number,
        publishedAt: menuVersions.publishedAt,
        contentHash: menuVersions.contentHash,
      })
      .from(menuPublications)
      .innerJoin(menuVersions, eq(menuVersions.id, menuPublications.versionId))
      .where(inArray(menuPublications.menuId, batch)))
      live.set(row.menuId, row);
  return live;
}

/**
 * Each menu's publication state. Every menu's document is built in one pass, because the menu list
 * asks again on every live change. An id that names no menu is left out.
 */
export async function menuStatus(
  tx: Transaction,
  menuIds: readonly string[],
): Promise<Map<string, MenuStatus>> {
  const status = new Map<string, MenuStatus>();
  if (menuIds.length === 0) return status;
  const { menus } = await buildMenuDocuments(tx, menuIds);
  const live = await liveVersions(tx, [...menus.keys()]);
  for (const [menuId, { document }] of menus) {
    const version = live.get(menuId);
    status.set(
      menuId,
      version === undefined
        ? { state: "unpublished" }
        : {
            state: menuDocumentHash(document) === version.contentHash ? "current" : "changed",
            version: version.number,
            publishedAt: version.publishedAt.toISOString(),
            hash: version.contentHash,
          },
    );
  }
  return status;
}

/** Each published menu's live version and its document. */
export async function readLiveDocuments(
  tx: Transaction,
  menuIds: readonly string[],
): Promise<Map<string, { versionId: string; document: MenuDocument }>> {
  const live = new Map<string, { versionId: string; document: MenuDocument }>();
  for (const batch of batches(menuIds))
    for (const row of await tx
      .select({
        menuId: menuPublications.menuId,
        versionId: menuVersions.id,
        document: menuVersions.document,
      })
      .from(menuPublications)
      .innerJoin(menuVersions, eq(menuVersions.id, menuPublications.versionId))
      .where(inArray(menuPublications.menuId, batch)))
      live.set(row.menuId, { versionId: row.versionId, document: row.document });
  return live;
}

/** Does the document's structure hold the section anywhere? */
function documentHoldsSection(document: MenuDocument, sectionId: string): boolean {
  const walk = (members: readonly DocumentMember[]): boolean =>
    members.some(
      (member) =>
        member.kind === "section" && (member.sectionId === sectionId || walk(member.members)),
    );
  return walk(document.root.members);
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

function sameEdit(a: DiffEntry, b: DiffEntry): boolean {
  if (changeSubject(a) !== changeSubject(b)) return false;
  const fields = fieldsOf(a.change);
  return fields === undefined || fields.some((field) => fieldsOf(b.change)!.includes(field));
}

/**
 * What publishing the menu would change, each change naming its source, and the shortcuts the
 * publish would leave out (D13). `hash` is what `publishMenu` must be handed back.
 *
 * A change inside a library section is the shared section's only while another menu reaches that
 * section, in its working structure or its live version. A shared change's `alsoOn` names the
 * other published menus whose own preview holds the same change.
 */
export async function previewMenu(
  tx: Transaction,
  menuId: string,
): Promise<{
  hash: string;
  changes: MenuChange[];
  warnings: { kind: "shortcut_omitted"; layoutName: string; name: string }[];
}> {
  const menuIds = (await tx.select({ menuId: menuDetails.menuId }).from(menuDetails)).map(
    (row) => row.menuId,
  );
  const { graph, menus } = await buildMenuDocuments(tx, menuIds);
  const mine = menus.get(menuId);
  if (mine === undefined) throw new AppError("catalogue.not_found", { catalogueId: menuId });
  const live = await readLiveDocuments(tx, [...menus.keys()]);
  const entries = diffEntries(live.get(menuId)?.document ?? null, mine.document);

  const removedButReached = new Set(
    reachableProducts(graph, mine.rootSectionId).filter((productId) =>
      entries.some(
        ({ change }) => change.kind === "product_removed" && change.productId === productId,
      ),
    ),
  );
  const deleted = new Set<string>();
  for (const batch of batches([...removedButReached]))
    for (const row of await tx
      .select({ id: products.id })
      .from(products)
      .where(and(inArray(products.id, batch), eq(products.active, false))))
      deleted.add(row.id);
  for (const entry of entries) {
    const { change } = entry;
    if (change.kind === "product_removed" && removedButReached.has(change.productId)) {
      change.source = deleted.has(change.productId) ? "shared_product" : "this_menu";
      delete entry.section;
    } else if (entry.section !== undefined) {
      const section = entry.section;
      const shared =
        menusContaining(graph, section).some((other) => other !== menuId) ||
        [...live].some(
          ([other, { document }]) => other !== menuId && documentHoldsSection(document, section),
        );
      if (!shared) {
        change.source = "this_menu";
        delete entry.section;
      }
    }
  }

  const shared = entries.filter(({ change }) => change.source !== "this_menu");
  if (shared.length > 0) {
    const others = [...live]
      .filter(([other]) => other !== menuId && menus.has(other))
      .map(([other, { document }]) => ({
        name: menus.get(other)!.document.menuName,
        entries: diffEntries(document, menus.get(other)!.document),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of shared) {
      const alsoOn = others
        .filter((other) => other.entries.some((candidate) => sameEdit(entry, candidate)))
        .map((other) => other.name);
      if (alsoOn.length > 0) entry.change.alsoOn = alsoOn;
    }
  }

  return {
    hash: menuDocumentHash(mine.document),
    changes: entries.map(({ change }) => change),
    warnings: await shortcutWarnings(tx, mine.document, mine.omittedShortcuts),
  };
}

async function shortcutWarnings(
  tx: Transaction,
  document: MenuDocument,
  omitted: readonly OmittedShortcut[],
): Promise<{ kind: "shortcut_omitted"; layoutName: string; name: string }[]> {
  const idOf = (ref: MemberRef) => (ref.kind === "product" ? ref.productId : ref.sectionId);
  const idsOf = (kind: MemberRef["kind"]) =>
    omitted.flatMap(({ ref }) => (ref.kind === kind ? [idOf(ref)] : []));
  const names = new Map<string, string>();
  for (const batch of batches(idsOf("product")))
    for (const row of await tx
      .select({ id: products.id, name: products.name })
      .from(products)
      .where(inArray(products.id, batch)))
      names.set(row.id, row.name);
  for (const batch of batches(idsOf("section")))
    for (const row of await tx
      .select({ id: sections.id, name: sections.internalName })
      .from(sections)
      .where(inArray(sections.id, batch)))
      names.set(row.id, row.name);
  const layoutNames = new Map(document.homeLayouts.map((layout) => [layout.id, layout.name]));
  return omitted.map(({ layoutId, ref }) => ({
    kind: "shortcut_omitted",
    layoutName: layoutNames.get(layoutId)!,
    name: names.get(idOf(ref))!,
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
): Promise<{ versionId: string; number: number }> {
  const { document } = await buildMenuDocument(tx, menuId);
  const contentHash = menuDocumentHash(document);
  if (contentHash !== expectedHash) throw new AppError("menu.changed_since_preview", { menuId });
  const current = (await liveVersions(tx, [menuId])).get(menuId);
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
