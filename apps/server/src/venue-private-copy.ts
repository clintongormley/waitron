import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

/**
 * Copies `venue.db` and whichever of its side files exist from `venueDir` into the empty `scratch`
 * folder, so a reader can open the copy and SQLite never rebuilds a journal in the original.
 * Answers whether `venue.db` was there; `refuse` is called for an entry that is not a plain file,
 * and for side files without their database. The caller holds the venue folder.
 */
export async function copyVenueFiles(
  venueDir: string,
  scratch: string,
  refuse: () => never,
): Promise<boolean> {
  async function copy(name: string): Promise<boolean> {
    let input;
    try {
      input = await open(
        join(venueDir, name),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
    try {
      if (!(await input.stat()).isFile()) refuse();
      const output = await open(join(scratch, name), "wx", 0o600);
      try {
        await pipeline(input.createReadStream(), output.createWriteStream());
      } finally {
        await output.close();
      }
      return true;
    } finally {
      await input.close();
    }
  }
  const present = await copy("venue.db");
  let sidecar = false;
  for (const suffix of ["-wal", "-journal", "-shm"])
    sidecar = (await copy(`venue.db${suffix}`)) || sidecar;
  if (!present && sidecar) refuse();
  return present;
}
