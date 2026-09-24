import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { URL, fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BUNDLE_EXTERNALS, bundle, esbuildArgs, parsePairs } from "./bundle-node.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BANNER =
  "--banner:js=import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);";

describe("the shared node bundle command", () => {
  it("leaves sharp out of every bundle", () => {
    expect(BUNDLE_EXTERNALS).toEqual(["sharp"]);
  });

  it("builds the esbuild arguments for one entry, with the banner as a single argument", () => {
    expect(esbuildArgs("src/bin.ts", "dist/server.js")).toEqual([
      "src/bin.ts",
      "--bundle",
      "--platform=node",
      "--format=esm",
      "--target=node24",
      "--external:sharp",
      "--outfile=dist/server.js",
      BANNER,
    ]);
  });

  it("reads entry=outfile pairs in the order given", () => {
    expect(parsePairs(["src/bin.ts=dist/server.js", "scripts/a.ts=dist/a.js"])).toEqual([
      { entry: "src/bin.ts", outfile: "dist/server.js" },
      { entry: "scripts/a.ts", outfile: "dist/a.js" },
    ]);
  });

  it("refuses to run with nothing to bundle", () => {
    expect(() => parsePairs([])).toThrow(/Usage: node .*bundle-node\.mjs <entry>=<outfile>/);
  });

  it.each([["src/bin.ts"], ["=dist/a.js"], ["src/bin.ts="], ["a=b=c"]])(
    "refuses the malformed pair %s",
    (pair) => {
      expect(() => parsePairs(["ok.ts=ok.js", pair])).toThrow(
        `Not an <entry>=<outfile> pair: ${pair}`,
      );
    },
  );

  it("runs esbuild once per pair, in order, with its output shown", () => {
    const calls = [];
    bundle(parsePairs(["a.ts=dist/a.js", "b.ts=dist/b.js"]), {
      run: (...call) => calls.push(call),
    });
    expect(calls).toEqual([
      ["esbuild", esbuildArgs("a.ts", "dist/a.js"), { stdio: "inherit" }],
      ["esbuild", esbuildArgs("b.ts", "dist/b.js"), { stdio: "inherit" }],
    ]);
  });

  it("stops at the first failing bundle", () => {
    const entries = [];
    const failure = new Error("esbuild exited 1");
    expect(() =>
      bundle(parsePairs(["a.ts=dist/a.js", "b.ts=dist/b.js", "c.ts=dist/c.js"]), {
        run: (_command, args) => {
          entries.push(args[0]);
          if (args[0] === "b.ts") throw failure;
        },
      }),
    ).toThrow(failure);
    expect(entries).toEqual(["a.ts", "b.ts"]);
  });

  it("prints its usage and exits 1 when run with no pairs", () => {
    const result = spawnSync(process.execPath, [join(ROOT, "scripts/bundle-node.mjs")], {
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Usage: node .*bundle-node\.mjs <entry>=<outfile>/);
  }, 20_000);

  /**
   * The real esbuild, reached the way `pnpm run` reaches it: through the package's own
   * `node_modules/.bin` on PATH. The fixture sits beside a `node_modules/sharp` that resolves, so
   * a missing external would bundle sharp rather than fail to find it. If sharp were bundled, the
   * output would hold sharp's own code and no literal `import("sharp")`, and this case would fail
   * on its `toContain`.
   */
  it("keeps a dynamic import of sharp as an import in a real bundle", () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-bundle-node-"));
    try {
      mkdirSync(join(dir, "node_modules"));
      symlinkSync(
        realpathSync(join(ROOT, "packages/media/node_modules/sharp")),
        join(dir, "node_modules/sharp"),
      );
      writeFileSync(join(dir, "entry.ts"), 'export const load = () => import("sharp");\n');
      const result = spawnSync(
        process.execPath,
        [join(ROOT, "scripts/bundle-node.mjs"), "entry.ts=dist/out.js"],
        {
          cwd: dir,
          encoding: "utf8",
          timeout: 20_000,
          env: {
            ...process.env,
            PATH: `${join(ROOT, "apps/server/node_modules/.bin")}${delimiter}${process.env.PATH}`,
          },
        },
      );
      expect(result.status, result.stderr).toBe(0);
      const output = readFileSync(join(dir, "dist/out.js"), "utf8");
      expect(output).toContain('import("sharp")');
      expect(output.startsWith("import { createRequire } from 'node:module';")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 40_000);
});
