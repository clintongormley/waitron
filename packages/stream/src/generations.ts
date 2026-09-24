import { randomUUID } from "node:crypto";
import { canonicalize } from "@waitron/membership";
import { AppError } from "@waitron/shared";
import "./errors.js";
import { putOwnBytes } from "./conditional.js";
import { parseGenerationName, venuePrefix } from "./names.js";
import type { ObjectStore } from "./object-store.js";

function parsed(field: string, generation: string): { term: number; nodeId: string } {
  const name = parseGenerationName(generation);
  if (name === null) throw new AppError("backup.stream_name_invalid", { field, value: generation });
  return name;
}

/** The folder a generation's objects live in, relative to the configured prefix. */
export function generationPrefix(venueId: string, generation: string): string {
  parsed("generation", generation);
  return `${venuePrefix(venueId)}${generation}/`;
}

export function markerKey(venueId: string, generation: string): string {
  return `${generationPrefix(venueId, generation)}opened.json`;
}

/**
 * Open a generation by creating its marker "only if absent". A folder that already has one is never
 * written into: the claim is refused (`backup.stream_precondition_failed`) and the box must not start
 * Litestream there. The nonce makes this claim's bytes unlike any other box's, so a refusal of our own
 * landed write can be told from a real loss.
 */
export async function claimGeneration(
  store: ObjectStore,
  venueId: string,
  generation: string,
): Promise<void> {
  const { term, nodeId } = parsed("generation", generation);
  const bytes = new TextEncoder().encode(
    canonicalize({ generation, venueId, term, nodeId, nonce: randomUUID() }),
  );
  await putOwnBytes(store, markerKey(venueId, generation), bytes, { ifNoneMatch: "*" });
}

/**
 * Delete every generation of this venue whose newest object is older than `windowMs` before `now`,
 * except `live` — the one the pointer names. Litestream tidies only the generation it writes (spec
 * §4.4). Only folders whose name is a generation name are ever touched; `current.json` and anything
 * else at the venue's root are not. Answers the names deleted, in order.
 */
export async function pruneGenerations(
  store: ObjectStore,
  venueId: string,
  live: string,
  now: Date,
  windowMs: number,
): Promise<string[]> {
  parsed("live", live);
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new AppError("backup.stream_name_invalid", {
      field: "windowMs",
      value: String(windowMs),
    });
  }
  const root = venuePrefix(venueId);
  type Folder = { name: string; newest: number; marker: string; claimed: boolean; files: string[] };
  // null for a folder whose name is not a generation's.
  const folders = new Map<string, Folder | null>();
  for (const object of await store.list(root)) {
    if (!object.key.startsWith(root)) {
      throw new AppError("backup.stream_name_invalid", { field: "listedKey", value: object.key });
    }
    const rest = object.key.slice(root.length);
    const slash = rest.indexOf("/");
    if (slash <= 0) continue;
    const name = rest.slice(0, slash);
    if (name === live) continue;
    let folder = folders.get(name);
    if (folder === undefined) {
      folder =
        parseGenerationName(name) === null
          ? null
          : {
              name,
              newest: Number.NEGATIVE_INFINITY,
              marker: markerKey(venueId, name),
              claimed: false,
              files: [],
            };
      folders.set(name, folder);
    }
    if (folder === null) continue;
    folder.newest = Math.max(folder.newest, object.lastModified.getTime());
    if (object.key === folder.marker) folder.claimed = true;
    else folder.files.push(object.key);
  }
  const cutoff = now.getTime() - windowMs;
  const doomed: Folder[] = [];
  for (const folder of folders.values()) {
    if (folder !== null && folder.newest < cutoff) doomed.push(folder);
  }
  doomed.sort((a, b) => (a.name < b.name ? -1 : 1));
  // Markers go last, so a prune interrupted partway leaves every generation that had a marker still
  // claimed.
  await store.deleteMany(doomed.flatMap((folder) => folder.files));
  await store.deleteMany(doomed.filter((folder) => folder.claimed).map((folder) => folder.marker));
  return doomed.map((folder) => folder.name);
}
