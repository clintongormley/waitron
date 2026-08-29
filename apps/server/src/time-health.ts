import { execFile } from "node:child_process";

/** Whether the system clock is NTP-synchronised. `source: "unavailable"` (never `warn: true`) on a host
 * without systemd's `timedatectl` — dev machines and macOS — so the probe never cries wolf where it
 * cannot know. The real appliance (systemd) gets the real answer. */
export type TimeHealth = { synced: boolean; source: "timedatectl" | "unavailable"; warn: boolean };

export type CommandRunner = (
  cmd: string,
  args: string[],
) => Promise<{ stdout: string; code: number }>;

// The real shell-out is environment-coupled: unit tests inject a runner instead (every branch above is
// covered that way), so the OS spawn here is never exercised in vitest and is ignored for coverage.
/* v8 ignore start */
const defaultRun: CommandRunner = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 2000 }, (error, stdout) => {
      // A non-zero EXIT (e.g. an unsynced state some builds signal by rc) still resolves with its
      // stdout; only a SPAWN failure (ENOENT — the binary is absent) rejects, and we map that to
      // "unavailable" below. `error.code` is a string on spawn failure, a number on non-zero exit.
      if (error && typeof (error as NodeJS.ErrnoException).code === "string") {
        reject(error);
        return;
      }
      resolve({ stdout, code: error ? ((error as { code?: number }).code ?? 1) : 0 });
    });
  });
/* v8 ignore stop */

export async function checkTimeHealth(deps: { run?: CommandRunner } = {}): Promise<TimeHealth> {
  const run = deps.run ?? defaultRun;
  try {
    const { stdout } = await run("timedatectl", ["show", "-p", "NTPSynchronized", "--value"]);
    const synced = stdout.trim() === "yes";
    return { synced, source: "timedatectl", warn: !synced };
  } catch {
    return { synced: false, source: "unavailable", warn: false };
  }
}
