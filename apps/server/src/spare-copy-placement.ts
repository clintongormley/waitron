import { existsSync } from "node:fs";
import { chmod, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { lockVenueDatabase } from "@waitron/db";
import { PAIR_COPY_DIR, SIDE_FILE_SUFFIXES, VENUE_FILE } from "@waitron/store";
import { litestreamMetaDir } from "@waitron/stream/litestream.js";
import { deleteBackupRoomNote } from "./backup-room-note.js";
import type { Logger } from "./logger.js";
import { VENUE_FILE_MODE } from "./restore.js";
import { PAIR_COPY_READY_FILE } from "./spare-copy.js";
import { reachDisk } from "./sync-path.js";

/**
 * Puts the first copy a spare's latch start took in place as its live `venue.db`, before this start
 * opens the store. `ready.json` is removed last, so a start that stops part way repeats this; a
 * repeat that finds the copy gone has already renamed it and leaves the live files alone, which
 * entry's ahead check may have opened since.
 */
export async function placeFirstCopy(deps: {
  stateDir: string;
  venueDir: string;
  log: Logger;
}): Promise<boolean> {
  const folder = join(deps.stateDir, PAIR_COPY_DIR);
  const ready = join(folder, PAIR_COPY_READY_FILE);
  if (!existsSync(ready)) return false;
  const hold = await lockVenueDatabase(deps.venueDir);
  try {
    const copy = join(folder, VENUE_FILE);
    const live = join(deps.venueDir, VENUE_FILE);
    await deleteBackupRoomNote(deps.stateDir);
    if (existsSync(copy)) {
      await chmod(copy, VENUE_FILE_MODE);
      await rm(litestreamMetaDir(live), { recursive: true, force: true });
      // An old -wal would be replayed into the copy by the first open.
      for (const suffix of SIDE_FILE_SUFFIXES) await rm(`${live}${suffix}`, { force: true });
      await reachDisk(deps.venueDir);
      await rename(copy, live);
      await reachDisk(deps.venueDir);
    }
    for (const entry of await readdir(folder))
      if (entry !== PAIR_COPY_READY_FILE)
        await rm(join(folder, entry), { recursive: true, force: true });
    await rm(ready);
    await rm(folder, { recursive: true, force: true });
    deps.log("info", "spare.first_copy_placed", {});
    return true;
  } finally {
    hold.release();
  }
}
