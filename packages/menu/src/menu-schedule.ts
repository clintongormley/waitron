import { assertMenuWritable } from "./archive.js";
import { and, asc, desc, eq, gt, lte, ne, or } from "drizzle-orm";
import { menuReleases, menuVersions, now, recordActivity, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import {
  buildPublishableMenu,
  insertVersion,
  liveVersions,
  nextNumber,
  overtakenBy,
  refuseOvertaken,
  settleDue,
} from "./menu-publication.js";
import type { MenuEdition, MenuPublications, QueuedEdition } from "@waitron/shared";
import "./errors.js";

const editionState = (state: typeof menuReleases.$inferSelect.state): MenuEdition["state"] =>
  state === "live" || state === "superseded" ? "activated" : state;

const SETTLED_LISTED = 10;

const editionColumns = {
  versionId: menuReleases.versionId,
  number: menuVersions.number,
  state: menuReleases.state,
  activatesAt: menuReleases.activatesAt,
  queuedAt: menuVersions.createdAt,
  cancelledAt: menuReleases.cancelledAt,
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
  const { document, workingHash: contentHash } = await buildPublishableMenu(tx, menuId);
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
    createdAt: at,
    createdBy: personId,
  });
  await tx.insert(menuReleases).values({ versionId, menuId, activatesAt, state: "queued" });
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
    .from(menuReleases)
    .innerJoin(menuVersions, eq(menuVersions.id, menuReleases.versionId))
    .where(and(eq(menuReleases.menuId, menuId), eq(menuReleases.state, "queued")))
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
  await assertMenuWritable(tx, menuId);
  await settleDue(tx, at, [menuId]);
  const [row] = await tx
    .select({ state: menuReleases.state })
    .from(menuReleases)
    .innerJoin(menuVersions, eq(menuVersions.id, menuReleases.versionId))
    .where(
      and(
        eq(menuReleases.versionId, versionId),
        eq(menuReleases.menuId, menuId),
        gt(menuReleases.activatesAt, menuVersions.createdAt),
      ),
    );
  if (row === undefined) throw new AppError("menu_publication.not_found", { menuId, versionId });
  if (row.state !== "queued")
    throw new AppError("menu_publication.not_queued", {
      menuId,
      versionId,
      state: row.state === "cancelled" ? "cancelled" : "activated",
    });
  await tx
    .update(menuReleases)
    .set({ state: "cancelled", cancelledAt: at, cancelledBy: personId })
    .where(eq(menuReleases.versionId, versionId));
}

export async function rescheduleMenuPublication(
  tx: Transaction,
  menuId: string,
  versionId: string,
  activatesAt: Date,
  personId: string,
  options: { at?: Date } = {},
): Promise<QueuedEdition> {
  const at = options.at ?? now();
  await assertMenuWritable(tx, menuId);
  await settleDue(tx, at, [menuId]);
  const [row] = await tx
    .select({
      state: menuReleases.state,
      number: menuVersions.number,
      activatesAt: menuReleases.activatesAt,
      createdAt: menuVersions.createdAt,
    })
    .from(menuReleases)
    .innerJoin(menuVersions, eq(menuVersions.id, menuReleases.versionId))
    .where(
      and(
        eq(menuReleases.versionId, versionId),
        eq(menuReleases.menuId, menuId),
        gt(menuReleases.activatesAt, menuVersions.createdAt),
      ),
    );
  if (row === undefined) throw new AppError("menu_publication.not_found", { menuId, versionId });
  if (row.state !== "queued")
    throw new AppError("menu_publication.not_queued", {
      menuId,
      versionId,
      state: row.state === "cancelled" ? "cancelled" : "activated",
    });
  if (activatesAt.getTime() <= at.getTime() || activatesAt.getTime() <= row.createdAt.getTime())
    throw new AppError("menu_publication.time_past", { activatesAt: activatesAt.toISOString() });
  refuseOvertaken(menuId, await overtakenBy(tx, menuId, row.number, activatesAt));
  await tx.update(menuReleases).set({ activatesAt }).where(eq(menuReleases.versionId, versionId));
  await recordActivity(tx, {
    kind: "menu_edition.rescheduled",
    subjectId: versionId,
    personId,
    data: { from: row.activatesAt.toISOString(), to: activatesAt.toISOString() },
    at,
  });
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
  const ofMenu = and(
    eq(menuReleases.menuId, menuId),
    gt(menuReleases.activatesAt, menuVersions.createdAt),
  );
  const editions = (base: ReturnType<typeof and>) =>
    tx
      .select(editionColumns)
      .from(menuReleases)
      .innerJoin(menuVersions, eq(menuVersions.id, menuReleases.versionId))
      .where(base);
  const waiting = and(eq(menuReleases.state, "queued"), gt(menuReleases.activatesAt, at));
  const queued = await editions(and(ofMenu, waiting)).orderBy(asc(menuReleases.activatesAt));
  const settled = await editions(
    and(ofMenu, or(ne(menuReleases.state, "queued"), lte(menuReleases.activatesAt, at))),
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
      state:
        row.state === "queued" && row.activatesAt <= at ? "activated" : editionState(row.state),
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
    .select({ activatesAt: menuReleases.activatesAt })
    .from(menuReleases)
    .where(and(eq(menuReleases.state, "queued"), gt(menuReleases.activatesAt, at)))
    .orderBy(asc(menuReleases.activatesAt))
    .limit(1);
  return { activated, nextDueAt: next?.activatesAt ?? null };
}
