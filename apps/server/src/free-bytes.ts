import { statfs as nodeStatfs } from "node:fs/promises";

export type Statfs = (path: string) => Promise<{ bavail: number; frsize: number }>;

/** Bytes an unprivileged writer may still use at `dir`, or null where the filesystem cannot say. */
export async function freeBytes(dir: string, statfs: Statfs = nodeStatfs): Promise<number | null> {
  try {
    // `bavail` counts fragments (POSIX `f_frsize`), not preferred blocks (`f_bsize`).
    const stats = await statfs(dir);
    return stats.bavail * stats.frsize;
  } catch {
    return null;
  }
}
