import { open } from "node:fs/promises";

/** Flushes a file's bytes, or a folder's entries, to the disk. */
export async function reachDisk(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
