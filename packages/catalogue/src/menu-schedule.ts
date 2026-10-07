import { and, asc, desc, eq, ne } from "drizzle-orm";
import { now, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { buildMenuDocument, menuDocumentHash } from "./menu-document.js";
import {
  insertVersion,
  liveVersions,
  nextNumber,
  overtakenBy,
  refuseOvertaken,
} from "./menu-publication.js";
import { menuScheduledPublications, menuVersions } from "./schema/publication.js";
import type { MenuEdition, MenuPublications, QueuedEdition } from "./menu-document-types.js";
import "./errors.js";

const SETTLED_LISTED = 10;

const editionColumns = {
  versionId: menuScheduledPublications.versionId,
  number: menuVersions.number,
  state: menuScheduledPublications.state,
  activatesAt: menuScheduledPublications.activatesAt,
  queuedAt: menuScheduledPublications.queuedAt,
  cancelledAt: menuScheduledPublications.cancelledAt,
  contentHash: menuVersions.contentHash,
};

/**
 * Fixes the menu's working state as a new edition that goes live at `activatesAt`, inside the
 * caller's one transaction. Refused, writing nothing, when the draft has clashes, no longer hashes
 * to `expectedHash`, is identical to the edition it would follow, or would overtake a queued
 * edition, and when `activatesAt` is not after `at`.
 */
export async function queueMenuPublication(
  tx: Transaction,
  menuId: string,
  expectedHash: string,
  activatesAt: Date,
  personId: string,
  options: { at?: Date } = {},
): Promise<QueuedEdition> {
  const at = options.at ?? now();
  const { document, clashes } = await buildMenuDocument(tx, menuId);
  if (clashes.length > 0)
    throw new AppError("menu.clashes_unresolved", { menuId, count: clashes.length });
  const contentHash = menuDocumentHash(document);
  if (contentHash !== expectedHash) throw new AppError("menu.changed_since_preview", { menuId });
  if (activatesAt.getTime() <= at.getTime())
    throw new AppError("menu_publication.time_past", { activatesAt: activatesAt.toISOString() });
  const number = await nextNumber(tx, menuId);
  refuseOvertaken(menuId, await overtakenBy(tx, menuId, number, activatesAt));
  const predecessor = await latestEdition(tx, menuId);
  if (predecessor?.contentHash === contentHash)
    throw new AppError("menu_publication.unchanged", { menuId, number: predecessor.number });
  const versionId = await insertVersion(tx, {
    menuId,
    number,
    document,
    contentHash,
    publishedAt: at,
    publishedBy: personId,
  });
  await tx
    .insert(menuScheduledPublications)
    .values({ versionId, menuId, activatesAt, queuedAt: at, queuedBy: personId });
  return { versionId, number, activatesAt: activatesAt.toISOString() };
}

/** The highest-numbered edition that is live or still queued. */
async function latestEdition(
  tx: Transaction,
  menuId: string,
): Promise<{ number: number; contentHash: string } | undefined> {
  const live = (await liveVersions(tx, [menuId], "metadata")).get(menuId);
  const [queued] = await tx
    .select({ number: menuVersions.number, contentHash: menuVersions.contentHash })
    .from(menuScheduledPublications)
    .innerJoin(menuVersions, eq(menuVersions.id, menuScheduledPublications.versionId))
    .where(
      and(
        eq(menuScheduledPublications.menuId, menuId),
        eq(menuScheduledPublications.state, "queued"),
      ),
    )
    .orderBy(desc(menuVersions.number))
    .limit(1);
  if (queued === undefined || (live !== undefined && live.number > queued.number)) return live;
  return queued;
}

/**
 * Cancels a queued edition. Its number is never used again. Refused `menu_publication.not_found`
 * when the version has no schedule row of this menu, `menu_publication.not_queued` once settled.
 */
export async function cancelMenuPublication(
  tx: Transaction,
  menuId: string,
  versionId: string,
  personId: string,
  at: Date = now(),
): Promise<void> {
  const [row] = await tx
    .select({ state: menuScheduledPublications.state })
    .from(menuScheduledPublications)
    .where(
      and(
        eq(menuScheduledPublications.versionId, versionId),
        eq(menuScheduledPublications.menuId, menuId),
      ),
    );
  if (row === undefined) throw new AppError("menu_publication.not_found", { menuId, versionId });
  if (row.state !== "queued")
    throw new AppError("menu_publication.not_queued", { menuId, versionId, state: row.state });
  await tx
    .update(menuScheduledPublications)
    .set({ state: "cancelled", cancelledAt: at, cancelledBy: personId })
    .where(eq(menuScheduledPublications.versionId, versionId));
}

/** The menu's live version, every queued edition soonest first, then the latest settled ones. */
export async function listMenuPublications(
  tx: Transaction,
  menuId: string,
): Promise<MenuPublications> {
  const live = (await liveVersions(tx, [menuId], "metadata")).get(menuId);
  const ofMenu = eq(menuScheduledPublications.menuId, menuId);
  const editions = (base: ReturnType<typeof and>) =>
    tx
      .select(editionColumns)
      .from(menuScheduledPublications)
      .innerJoin(menuVersions, eq(menuVersions.id, menuScheduledPublications.versionId))
      .where(base);
  const queued = await editions(and(ofMenu, eq(menuScheduledPublications.state, "queued"))).orderBy(
    asc(menuScheduledPublications.activatesAt),
  );
  const settled = await editions(and(ofMenu, ne(menuScheduledPublications.state, "queued")))
    .orderBy(desc(menuVersions.number))
    .limit(SETTLED_LISTED);
  return {
    live:
      live === undefined
        ? null
        : { versionId: live.versionId, number: live.number, since: live.publishedAt.toISOString() },
    editions: [...queued, ...settled].map((row): MenuEdition => ({
      ...row,
      activatesAt: row.activatesAt.toISOString(),
      queuedAt: row.queuedAt.toISOString(),
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
    })),
  };
}
