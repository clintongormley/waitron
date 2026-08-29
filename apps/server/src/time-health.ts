import { execFile } from "node:child_process";

/** Whether the system clock is NTP-synchronised. `source: "unavailable"` (never `warn: true`) on a host
 * without systemd's `timedatectl` — dev machines and macOS — so the probe never cries wolf where it
 * cannot know. Where systemd's `timedatectl` is present (the appliance), it reports the real sync
 * state. */
export type TimeHealth = { synced: boolean; source: "timedatectl" | "unavailable"; warn: boolean };

export type CommandRunner = (cmd: string, args: string[]) => Promise<{ stdout: string }>;

// The injected-runner tests cover every branch in `checkTimeHealth` below; the `?? defaultRun`
// fallback and the default-parameter branch stay structurally uncovered by design — the real OS
// shell-out here is environment-coupled and unreachable from a unit test, so it is v8-ignored.
/* v8 ignore start */
const defaultRun: CommandRunner = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 2000 }, (error, stdout) => {
      // A non-zero EXIT (e.g. an unsynced state some builds signal by rc) still resolves with its
      // stdout, mapping to a real sync check below. Two failure shapes must instead reject so the
      // caller's catch maps them to "unavailable" (honest "can't determine", never a false warn):
      // a SPAWN failure (ENOENT — binary absent), where `error.code` is a string; and the `{ timeout }`
      // KILL of a hung probe, where `error.code` is `null` but `error.killed` is true (empty stdout
      // would otherwise read as "not synced" and cry wolf).
      const err = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
      if (err && (typeof err.code === "string" || err.killed)) {
        reject(err);
        return;
      }
      resolve({ stdout });
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
