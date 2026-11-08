import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll } from "vitest";
import { bundle } from "../../../../scripts/bundle-node.mjs";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const SERVER_ENTRY = "src/bin.ts";

function bundleName(entry: string): string {
  if (entry === SERVER_ENTRY) return "server.js";
  return `${entry.replace(/\.ts$/, "").replace(/\W+/g, "-").replace(/^-/, "")}.js`;
}

/**
 * Builds the named entries, given relative to `apps/server` (`src/bin.ts` when none are named), for
 * this test file and returns a reader of a bundle's path. The directory is per file so that files
 * running at once cannot collide and a bundle is never older than the source; it sits under
 * `apps/server` so the `sharp` external resolves with no linked `node_modules`, through which
 * `copy-migrations.mjs` would replace the real `@waitron/ui-core` link.
 */
export function useBuiltServer(
  entries: readonly string[] = [SERVER_ENTRY],
): (entry?: string) => string {
  let directory: string | undefined;
  beforeAll(async () => {
    const cache = join(packageRoot, "node_modules/.cache");
    await mkdir(cache, { recursive: true });
    const target = await mkdtemp(join(cache, "built-server-"));
    directory = target;
    execFileSync(process.execPath, [join(packageRoot, "scripts/copy-migrations.mjs"), target], {
      stdio: "pipe",
    });
    bundle(
      entries.map((entry) => ({
        entry: join(packageRoot, entry),
        outfile: join(target, bundleName(entry)),
      })),
      { writeNotices: () => {} },
    );
  });
  afterAll(async () => {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  });
  return (entry = SERVER_ENTRY) => {
    if (directory === undefined) throw new Error("useBuiltServer's beforeAll has not run");
    if (!entries.includes(entry)) throw new Error(`useBuiltServer did not bundle ${entry}`);
    return join(directory, bundleName(entry));
  };
}
