import { execFile } from "node:child_process";

/** Whether the host's time service has synchronised the clock, as `timedatectl` reports it. A
 * missing, failing or slow `timedatectl` answers false. */
export function timedatectlSynchronised(
  deps: { command?: string; timeoutMs?: number } = {},
): () => Promise<boolean> {
  return () =>
    new Promise((resolve) => {
      execFile(
        deps.command ?? "timedatectl",
        ["show", "-p", "NTPSynchronized", "--value"],
        { timeout: deps.timeoutMs ?? 2_000 },
        (error, stdout) => resolve(error === null && stdout.trim() === "yes"),
      );
    });
}
