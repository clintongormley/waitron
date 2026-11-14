import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { PAIR_COPY_DIR } from "@waitron/store";
import { reachDisk } from "./sync-path.js";

export const COPY_READY_FILE = "ready.json";
export interface SelectedCopy {
  source: "selected-backup";
  sourceId: string;
}

export async function readSelectedCopy(stateDir: string): Promise<SelectedCopy | null> {
  const path = join(stateDir, PAIR_COPY_DIR, COPY_READY_FILE);
  if (!existsSync(path)) return null;
  const value = JSON.parse(await readFile(path, "utf8")) as SelectedCopy;
  return value.source === "selected-backup" ? value : null;
}

export async function clearSelectedCopy(stateDir: string): Promise<void> {
  if ((await readSelectedCopy(stateDir)) === null) return;
  const folder = join(stateDir, PAIR_COPY_DIR);
  // The marker must disappear durably before any file it vouches for is replaced or removed.
  await rm(join(folder, COPY_READY_FILE));
  await reachDisk(folder);
  await rm(folder, { recursive: true, force: true });
  await reachDisk(stateDir);
}
