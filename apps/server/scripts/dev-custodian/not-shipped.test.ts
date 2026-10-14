// Weaker than its name in two ways: it reads deploy/Dockerfile's copy list as text, so a bundle
// copied by any other spelling is not bundled here; and it covers only apps/server's bundles — the
// browser bundles are not checked (they never include a Vite config, where the setup proxy lives).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, describe, expect, it } from "vitest";

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = resolve(serverDir, "../..");
const outdir = mkdtempSync(join(tmpdir(), "waitron-not-shipped-"));

afterAll(() => rmSync(outdir, { recursive: true, force: true }));

function copiedOutfiles(): string[] {
  const dockerfile = readFileSync(join(repoRoot, "deploy/Dockerfile"), "utf8");
  const names = [...dockerfile.matchAll(/\/src\/apps\/server\/dist\/([\w-]+\.js)(?![.\w])/g)].map(
    (match) => `dist/${match[1]}`,
  );
  return [...new Set(names)];
}

function buildEntries(): Map<string, string> {
  const manifest = JSON.parse(readFileSync(join(serverDir, "package.json"), "utf8")) as {
    scripts: { build: string };
  };
  const entries = new Map<string, string>();
  for (const match of manifest.scripts.build.matchAll(/(\S+\.ts)=(dist\/\S+\.js)/g)) {
    entries.set(match[2]!, match[1]!);
  }
  return entries;
}

describe("the throwaway custodian is not in anything the image ships", () => {
  it("no server bundle the image copies loads the dev custodian or the demo allocation", async () => {
    const outfiles = copiedOutfiles();
    expect(outfiles).toContain("dist/server.js");
    expect(outfiles).toContain("dist/node-entry.js");
    const entries = buildEntries();
    const entryPoints = outfiles.map((outfile) => {
      const entry = entries.get(outfile);
      expect(entry, `no build entry writes ${outfile}`).toBeDefined();
      return entry!;
    });

    const bundleNodePath = join(repoRoot, "scripts/bundle-node.mjs");
    const { BUNDLE_EXTERNALS } = (await import(pathToFileURL(bundleNodePath).href)) as {
      BUNDLE_EXTERNALS: readonly string[];
    };
    const result = await build({
      absWorkingDir: serverDir,
      entryPoints,
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node24",
      external: [...BUNDLE_EXTERNALS],
      outdir,
      write: false,
      metafile: true,
      logLevel: "silent",
    });

    // Every file esbuild loaded, including ones whose code it then dropped as unused; the
    // per-output input lists omit those, so a bare import would pass a check on them.
    const loaded = Object.keys(result.metafile.inputs);
    expect(loaded).toContain("scripts/demo-seed/seed.ts");
    expect(
      loaded.filter(
        (path) =>
          path.startsWith("scripts/dev-custodian/") || path === "scripts/demo-seed/allocation.ts",
      ),
    ).toEqual([]);
  });
});
