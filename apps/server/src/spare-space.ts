import { lstat, unlink as unlinkFile } from "node:fs/promises";
import { join } from "node:path";
import { SPARE_SPACE_FILE } from "@waitron/provisioning";
import { errnoOf } from "./errno.js";
import type { Logger } from "./logger.js";

/**
 * Deletes the box's spare file so a nearly full disk has room to take a venue folder's lock; answers
 * the bytes it held. Only a regular file is deleted. Nothing is thrown.
 */
export async function releaseSpare(
  stateDir: string,
  log: Logger,
  fs: { unlink: (path: string) => Promise<void> } = { unlink: unlinkFile },
): Promise<number> {
  const path = join(stateDir, SPARE_SPACE_FILE);
  try {
    const info = await lstat(path);
    if (!info.isFile()) {
      log("warn", "storage.spare_unusable", { kind: "other" });
      return 0;
    }
    await fs.unlink(path);
    log("warn", "storage.spare_released", { bytes: info.size });
    return info.size;
  } catch (error) {
    const errno = errnoOf(error);
    if (errno !== "ENOENT") log("warn", "storage.spare_release_failed", { errno: errno ?? null });
    return 0;
  }
}
