import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll } from "vitest";
import { bundle } from "../../../../scripts/bundle-node.mjs";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * Builds `src/bin.ts` for this test file and returns a reader of the bundle's path. No release is
 * passed because a `tsx` run has none either. The directory is per file so that files running at
 * once cannot collide and a bundle is never older than the source; it sits under `apps/server` so
 * the `sharp` external resolves with no linked `node_modules`, through which `copy-migrations.mjs`
 * would replace the real `@waitron/ui-core` link.
 */
export function useBuiltServer(): () => string {
  let directory: string | undefined;
  beforeAll(async () => {
    const cache = join(packageRoot, "node_modules/.cache");
    await mkdir(cache, { recursive: true });
    directory = await mkdtemp(join(cache, "built-server-"));
    execFileSync(process.execPath, [join(packageRoot, "scripts/copy-migrations.mjs"), directory], {
      stdio: "pipe",
    });
    bundle([{ entry: join(packageRoot, "src/bin.ts"), outfile: join(directory, "server.js") }], {
      writeNotices: () => {},
    });
  });
  afterAll(async () => {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  });
  return () => {
    if (directory === undefined) throw new Error("useBuiltServer's beforeAll has not run");
    return join(directory, "server.js");
  };
}
