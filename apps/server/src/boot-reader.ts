import { readFileSync } from "node:fs";

const UPTIME = "/proc/uptime";
const BOOT_ID = "/proc/sys/kernel/random/boot_id";

export interface BootReading {
  readonly ms: number;
  /** Null whenever `ms` did not come from `/proc/uptime`, so two different counters are never
   * paired under one boot id. */
  readonly id: string | null;
}

export interface BootReader {
  readBoot(): BootReading;
  elapsed(): number;
}

/** Linux's boot-time clock (`/proc/uptime`), which keeps counting while the machine is suspended;
 * performance.now() stops during a suspend there. Where `/proc/uptime` gives no number at
 * creation, performance.now() for the life of the reader. A later read that fails answers NaN. */
export function bootReader(
  read: (path: string) => string = (path) => readFileSync(path, "utf8"),
): BootReader {
  const uptimeMs = () => {
    try {
      return Number.parseFloat(read(UPTIME)) * 1000;
    } catch {
      return Number.NaN;
    }
  };
  if (!Number.isFinite(uptimeMs())) {
    return {
      readBoot: () => ({ ms: performance.now(), id: null }),
      elapsed: () => performance.now(),
    };
  }
  const bootId = () => {
    try {
      const id = read(BOOT_ID).trim();
      return id.length > 0 ? id : null;
    } catch {
      return null;
    }
  };
  return {
    readBoot: () => {
      const ms = uptimeMs();
      return { ms, id: Number.isFinite(ms) ? bootId() : null };
    },
    elapsed: uptimeMs,
  };
}
