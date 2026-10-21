import { execFileSync } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  statfsSync,
  truncateSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const REQUIRE_FULL_DISK =
  process.env.CI === "true" || process.env.WAITRON_REQUIRE_FULL_DISK === "1";

/** The largest filesystem the harness will fill, so a folder on a machine's main disk is refused. */
const MAX_FILESYSTEM_BYTES = 64 * 1024 * 1024;
const HDIUTIL_TIMEOUT_MS = 60_000;
const FILL_WRITES = [64 * 1024, 512, 1];

export interface SmallDisk {
  /** A fresh folder on the small filesystem, for one case. */
  folder(name: string): string;
  /** Writes a filler until the system refuses (64 KiB, then 512 B, then 1 B writes), then gives `leave` bytes back. */
  fill(leave?: number): void;
  unfill(): void;
  free(): number;
  close(): void;
}

function smallDiskAt(root: string, close: () => void): SmallDisk {
  const filler = join(root, "filler");
  return {
    folder(name) {
      const path = join(root, name);
      mkdirSync(path);
      return path;
    },
    fill(leave = 0) {
      const fd = openSync(filler, "a");
      let wrote = 0;
      let refusal: unknown;
      try {
        for (const size of FILL_WRITES) {
          const chunk = Buffer.alloc(size, 1);
          for (;;) {
            try {
              wrote += writeSync(fd, chunk);
            } catch (error) {
              refusal = error;
              break;
            }
          }
        }
      } finally {
        closeSync(fd);
      }
      if ((refusal as { code?: unknown } | undefined)?.code !== "ENOSPC") {
        throw new Error("the filler stopped for a reason other than a full disk", {
          cause: refusal,
        });
      }
      if (leave > 0) truncateSync(filler, Math.max(0, wrote - leave));
    },
    unfill() {
      rmSync(filler, { force: true });
    },
    free() {
      const stats = statfsSync(root);
      return Number(stats.bavail) * Number(stats.frsize);
    },
    close,
  };
}

function namedFolder(dir: string): { ok: true; disk: SmallDisk } | { ok: false; reason: string } {
  const stats = statfsSync(dir);
  const size = Number(stats.blocks) * Number(stats.frsize);
  if (size > MAX_FILESYSTEM_BYTES) {
    return {
      ok: false,
      reason: `WAITRON_FULL_DISK_DIR (${dir}) holds ${size} bytes; the full-disk tests fill only a filesystem of 64 MiB or less`,
    };
  }
  const root = mkdtempSync(join(dir, "wt-full-disk-"));
  return {
    ok: true,
    disk: smallDiskAt(root, () => rmSync(root, { recursive: true, force: true })),
  };
}

function hdiutilImage(): { ok: true; disk: SmallDisk } {
  const base = mkdtempSync(join(tmpdir(), "wt-full-disk-"));
  const image = join(base, "disk.dmg");
  const mount = join(base, "mnt");
  const run = (args: string[]) =>
    execFileSync("hdiutil", args, { timeout: HDIUTIL_TIMEOUT_MS, stdio: "pipe" });
  let attached = false;
  const close = () => {
    // A failed detach leaves the image mounted: removing its folder would throw and hide why.
    if (attached) run(["detach", mount, "-force", "-quiet"]);
    rmSync(base, { recursive: true, force: true });
  };
  try {
    mkdirSync(mount);
    run([
      "create",
      "-size",
      "32m",
      "-fs",
      "HFS+",
      "-volname",
      "wt-full-disk",
      "-layout",
      "NONE",
      image,
      "-quiet",
    ]);
    run(["attach", image, "-mountpoint", mount, "-nobrowse", "-noautoopen", "-quiet"]);
    attached = true;
  } catch (error) {
    close();
    throw error;
  }
  const stats = statfsSync(mount);
  if (Number(stats.blocks) * Number(stats.frsize) > MAX_FILESYSTEM_BYTES) {
    close();
    throw new Error(`the image mounted at ${mount} is larger than 64 MiB`);
  }
  return { ok: true, disk: smallDiskAt(mount, close) };
}

/** A filesystem of 64 MiB or less that the tests may fill, or why there is none. */
export function openSmallDisk(): { ok: true; disk: SmallDisk } | { ok: false; reason: string } {
  const dir = process.env.WAITRON_FULL_DISK_DIR;
  if (dir !== undefined && dir !== "") return namedFolder(dir);
  if (process.platform === "darwin") return hdiutilImage();
  return {
    ok: false,
    reason: "no small filesystem: set WAITRON_FULL_DISK_DIR to one of 64 MiB or less",
  };
}
