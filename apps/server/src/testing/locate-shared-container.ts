import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Locate the shared test Postgres container by its published host port + the harness label, for the
 * real-container `docker exec` smoke tests (`pg-restore.test.ts`, `backup-sweep.test.ts`). Returns
 * the container id, or `undefined` after a LOUD `console.warn` skip when the `docker` CLI cannot run
 * or no matching container is found — a skipped smoke proves nothing (CLAUDE.md §2), so it is never
 * silently green. `skip.tag` names the smoke in the `[<tag> SKIPPED]` prefix and `skip.unproven` is
 * the trailing "<what> is UNPROVEN in this run." sentence, so each caller's message stays exactly its
 * own. Lives in `src/testing/` (coverage-excluded) so the two suites share this block, not a copy.
 */
export async function locateSharedContainer(
  uri: URL,
  skip: { tag: string; unproven: string },
): Promise<string | undefined> {
  let containerId: string;
  try {
    const { stdout } = await execFileAsync("docker", [
      "ps",
      "--filter",
      `publish=${uri.port}`,
      "--filter",
      "label=com.waitron.reapable",
      "--format",
      "{{.ID}}",
    ]);
    containerId = stdout.trim().split("\n")[0]!.trim();
  } catch (err) {
    console.warn(
      `[${skip.tag} SKIPPED] could not run \`docker ps\` to locate the test container: ${String(err)}. ` +
        skip.unproven,
    );
    return undefined;
  }
  if (containerId === "") {
    console.warn(
      `[${skip.tag} SKIPPED] no running container published on port ${uri.port} with label ` +
        `com.waitron.reapable. ${skip.unproven}`,
    );
    return undefined;
  }
  return containerId;
}
