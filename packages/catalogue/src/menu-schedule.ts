import { and, asc, desc, eq, gt, lte, ne, or } from "drizzle-orm";
import { now, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { buildMenuDocument, menuDocumentHash } from "./menu-document.js";
import {
  insertVersion,
  liveVersions,
  nextNumber,
  overtakenBy,
  refuseOvertaken,
  settleDue,
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
  await settleDue(tx, at, [menuId]);
  const { document, clashes } = await buildMenuDocument(tx, menuId);
  if (clashes.length > 0)
    throw new AppError("menu.clashes_unresolved", { menuId, count: clashes.length });
  const contentHash = menuDocumentHash(document);
  if (contentHash !== expectedHash) throw new AppError("menu.changed_since_preview", { menuId });
  if (activatesAt.getTime() <= at.getTime())
    throw new AppError("menu_publication.time_past", { activatesAt: activatesAt.toISOString() });
  const number = await nextNumber(tx, menuId);
  refuseOvertaken(menuId, await overtakenBy(tx, menuId, number, activatesAt));
  const predecessor = await latestEdition(tx, menuId, at);
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
  at: Date,
): Promise<{ number: number; contentHash: string } | undefined> {
  const live = (await liveVersions(tx, [menuId], "metadata", at)).get(menuId);
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
  await settleDue(tx, at, [menuId]);
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

/**
 * Moves a queued edition to `activatesAt`, inside the caller's one transaction. Refused, writing
 * nothing, when the version has no schedule row of this menu, is no longer queued, `activatesAt`
 * is not after `at`, or the move would overtake another queued edition.
 */
export async function rescheduleMenuPublication(
  tx: Transaction,
  menuId: string,
  versionId: string,
  activatesAt: Date,
  options: { at?: Date } = {},
): Promise<QueuedEdition> {
  const at = options.at ?? now();
  await settleDue(tx, at, [menuId]);
  const [row] = await tx
    .select({ state: menuScheduledPublications.state, number: menuVersions.number })
    .from(menuScheduledPublications)
    .innerJoin(menuVersions, eq(menuVersions.id, menuScheduledPublications.versionId))
    .where(
      and(
        eq(menuScheduledPublications.versionId, versionId),
        eq(menuScheduledPublications.menuId, menuId),
      ),
    );
  if (row === undefined) throw new AppError("menu_publication.not_found", { menuId, versionId });
  if (row.state !== "queued")
    throw new AppError("menu_publication.not_queued", { menuId, versionId, state: row.state });
  if (activatesAt.getTime() <= at.getTime())
    throw new AppError("menu_publication.time_past", { activatesAt: activatesAt.toISOString() });
  refuseOvertaken(menuId, await overtakenBy(tx, menuId, row.number, activatesAt));
  await tx
    .update(menuScheduledPublications)
    .set({ activatesAt })
    .where(eq(menuScheduledPublications.versionId, versionId));
  return { versionId, number: row.number, activatesAt: activatesAt.toISOString() };
}

/**
 * The menu's live version at `at`, every edition still queued soonest first, then the latest
 * settled ones. Writes nothing: an edition whose time has passed reads as activated before any
 * settle marks it.
 */
export async function listMenuPublications(
  tx: Transaction,
  menuId: string,
  at: Date = now(),
): Promise<MenuPublications> {
  const live = (await liveVersions(tx, [menuId], "metadata", at)).get(menuId);
  const ofMenu = eq(menuScheduledPublications.menuId, menuId);
  const editions = (base: ReturnType<typeof and>) =>
    tx
      .select(editionColumns)
      .from(menuScheduledPublications)
      .innerJoin(menuVersions, eq(menuVersions.id, menuScheduledPublications.versionId))
      .where(base);
  const waiting = and(
    eq(menuScheduledPublications.state, "queued"),
    gt(menuScheduledPublications.activatesAt, at),
  );
  const queued = await editions(and(ofMenu, waiting)).orderBy(
    asc(menuScheduledPublications.activatesAt),
  );
  const settled = await editions(
    and(
      ofMenu,
      or(
        ne(menuScheduledPublications.state, "queued"),
        lte(menuScheduledPublications.activatesAt, at),
      ),
    ),
  )
    .orderBy(desc(menuVersions.number))
    .limit(SETTLED_LISTED);
  return {
    live:
      live === undefined
        ? null
        : { versionId: live.versionId, number: live.number, since: live.since.toISOString() },
    editions: [...queued, ...settled].map((row): MenuEdition => ({
      ...row,
      state: row.state === "queued" && row.activatesAt <= at ? "activated" : row.state,
      activatesAt: row.activatesAt.toISOString(),
      queuedAt: row.queuedAt.toISOString(),
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
    })),
  };
}

/** Settles every menu; `nextDueAt` is the soonest queued activation after `at`. */
export async function activateDueMenuPublications(
  tx: Transaction,
  at: Date = now(),
): Promise<{
  activated: { menuId: string; versionId: string; number: number }[];
  nextDueAt: Date | null;
}> {
  const activated = await settleDue(tx, at);
  const [next] = await tx
    .select({ activatesAt: menuScheduledPublications.activatesAt })
    .from(menuScheduledPublications)
    .where(
      and(
        eq(menuScheduledPublications.state, "queued"),
        gt(menuScheduledPublications.activatesAt, at),
      ),
    )
    .orderBy(asc(menuScheduledPublications.activatesAt))
    .limit(1);
  return { activated, nextDueAt: next?.activatesAt ?? null };
}
