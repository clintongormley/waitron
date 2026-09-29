import { statSync } from "node:fs";
import { tmpdir } from "node:os";

const isExistingDirectory = (path) =>
  statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;

/**
 * Where a suite that commits to SQLite many times should make its scratch directory: `/dev/shm`,
 * a memory-backed filesystem on Linux, when there is one. On a CI runner's disk the upgrade test
 * ran 2.5 to 6 times slower than in memory; `docs/developers/ci-and-gates.md` holds the measurement.
 */
export function scratchParent({ isDirectory = isExistingDirectory } = {}) {
  return isDirectory("/dev/shm") ? "/dev/shm" : tmpdir();
}
