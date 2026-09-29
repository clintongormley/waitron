import { statSync } from "node:fs";
import { tmpdir } from "node:os";

const isDirectoryOnDisk = (path) =>
  statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;

/**
 * Where a suite that commits to SQLite many times should make its scratch directory: `/dev/shm`,
 * a memory-backed filesystem on Linux, when there is one. On a CI runner's disk each commit's flush
 * dominates such a suite; `docs/developers/ci-and-gates.md` holds the measurement.
 */
export function scratchParent({ isDirectory = isDirectoryOnDisk } = {}) {
  return isDirectory("/dev/shm") ? "/dev/shm" : tmpdir();
}
