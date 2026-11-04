// The real placement in its own process, killed with SIGKILL just before one file step, so no
// `finally` and no clean-up runs: what is on the disk afterwards is what a crash leaves.
import { writeFileSync } from "node:fs";
import { chmod, copyFile, open, rename, rm } from "node:fs/promises";
import { placeAcceptedCopyAtStart } from "../handover-place-copy.js";

const [venueDir, stateDir, nodeId, at] = process.argv.slice(2) as [string, string, string, string];

function killedAt(step: string): void {
  if (step === at) process.kill(process.pid, "SIGKILL");
}

async function flush(path: string): Promise<void> {
  const handle = await open(path, "r");
  await handle.sync();
  await handle.close();
}

let folderFlushes = 0;
await placeAcceptedCopyAtStart({
  venueDir,
  stateDir,
  nodeId,
  log: () => {},
  fs: {
    copyFile: async (from, to) => {
      if (at === "copy") writeFileSync(to, "half a copy");
      killedAt("copy");
      await copyFile(from, to);
    },
    chmod: async (path, mode) => {
      killedAt("chmod");
      await chmod(path, mode);
    },
    reachDisk: async (path) => {
      if (path.endsWith(".incoming")) killedAt("flush-incoming");
      else {
        folderFlushes += 1;
        killedAt(folderFlushes === 1 ? "flush-before-rename" : "flush-after-rename");
      }
      await flush(path);
    },
    rm: async (path, options) => {
      if (path.endsWith("-litestream")) killedAt("litestream");
      if (path.endsWith("-wal")) killedAt("wal");
      if (path.endsWith("-shm")) killedAt("shm");
      await rm(path, options);
    },
    rename: async (from, to) => {
      if (from.endsWith(".incoming")) killedAt("rename");
      await rename(from, to);
    },
  },
});
killedAt("answered");
