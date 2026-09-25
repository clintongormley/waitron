import { generationPrefix } from "./generations.js";
import type { ListedObject, ObjectStore } from "./object-store.js";

/** The newest `lastModified` among `objects`, or `floor` when none is newer. */
export const newestOf = (objects: readonly ListedObject[], floor: Date | null): Date | null =>
  objects.reduce<Date | null>(
    (newest, object) =>
      newest === null || object.lastModified > newest ? object.lastModified : newest,
    floor,
  );

/**
 * When a generation last changed, by the bucket's clock: the newest object in it, or only in one
 * level's folder when `level` is given; `floor` when nothing listed is newer.
 */
export async function newestUpload(
  store: ObjectStore,
  venueId: string,
  generation: string,
  options: { level?: number; floor?: Date | null } = {},
): Promise<Date | null> {
  const prefix = generationPrefix(venueId, generation);
  const folder =
    options.level === undefined
      ? prefix
      : `${prefix}${options.level.toString(16).padStart(4, "0")}/`;
  return newestOf(await store.list(folder), options.floor ?? null);
}

/**
 * The bucket's clock minus the caller's, in milliseconds: `key`'s `lastModified` against the middle
 * of its write, which ran from `started` to `ended` on the caller's clock. Null when the listing does
 * not show `key`; a failed listing is thrown.
 */
export async function bucketClockOffset(
  store: ObjectStore,
  key: string,
  started: number,
  ended: number,
): Promise<number | null> {
  const listed = (await store.list(key)).find((object) => object.key === key);
  return listed === undefined ? null : listed.lastModified.getTime() - (started + ended) / 2;
}
