import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
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
import { URL, fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BUNDLE_EXTERNALS,
  bundle,
  esbuildArgs,
  parsePairs,
  releaseDefine,
} from "./bundle-node.mjs";
import { isReleaseVersion } from "../packages/shared/src/built-release.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BANNER =
  "--banner:js=import { createRequire as __waitronCreateRequire } from 'node:module'; const require = __waitronCreateRequire(import.meta.url);";

// These fixtures exercise plain bundles; appliance provenance has its own real-source CLI tests.
function plainBundleCommand(directory) {
  const scripts = join(directory, "scripts");
  mkdirSync(scripts);
  for (const file of [
    "bundle-node.mjs",
    "generate-hour-release.mjs",
    "npm-bundle-notices.mjs",
    "backup-verification-runtime.mjs",
    "is-main-script.mjs",
  ])
    copyFileSync(join(ROOT, "scripts", file), join(scripts, file));
  return realpathSync(join(scripts, "bundle-node.mjs"));
}

/** Runs the copied command the way `pnpm run` reaches esbuild, with `WAITRON_RELEASE_VERSION` only
 * as `setting` gives it. */
function runBundleCommand(directory, pair, setting = {}) {
  const inherited = { ...process.env };
  delete inherited.WAITRON_RELEASE_VERSION;
  return spawnSync(process.execPath, [plainBundleCommand(directory), pair], {
    cwd: directory,
    encoding: "utf8",
    timeout: 20_000,
    env: {
      ...inherited,
      ...setting,
      PATH: `${join(ROOT, "apps/server/node_modules/.bin")}${delimiter}${process.env.PATH}`,
    },
  });
}

const LONGEST_RELEASE = `${"9".repeat(46)}.2.3`;
const TOO_LONG_RELEASE = `${"9".repeat(47)}.2.3`;

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
      "--metafile=dist/server.js.meta.json",
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
      writeNotices: () => {},
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
        writeNotices: () => {},
        run: (_command, args) => {
          entries.push(args[0]);
          if (args[0] === "b.ts") throw failure;
        },
      }),
    ).toThrow(failure);
    expect(entries).toEqual(["a.ts", "b.ts"]);
  });

  it("writes one notice from esbuild's input list and removes the temporary metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-bundle-meta-"));
    try {
      const outfile = join(dir, "out.js");
      const lit = realpathSync(join(ROOT, "apps/till/node_modules/lit/index.js"));
      bundle([{ entry: "entry.ts", outfile }], {
        run: () => writeFileSync(`${outfile}.meta.json`, JSON.stringify({ inputs: { [lit]: {} } })),
      });
      expect(readFileSync(`${outfile}.NOTICES.txt`, "utf8")).toContain("lit 3.3.3");
      expect(existsSync(`${outfile}.meta.json`)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([[{}], [{ WAITRON_RELEASE_VERSION: "" }]])(
    "stamps no release when the build setting is %j",
    (env) => {
      expect(releaseDefine(env)).toBe("null");
    },
  );

  it.each([["1.2.3"], [LONGEST_RELEASE]])("stamps the release version %s", (value) => {
    expect(releaseDefine({ WAITRON_RELEASE_VERSION: value })).toBe(
      JSON.stringify({ version: value }),
    );
  });

  it.each([["1.2.3-rc1"], ["v1.2.3"], ["01.2.3"], [TOO_LONG_RELEASE]])(
    "refuses the release version %s",
    (value) => {
      expect(() => releaseDefine({ WAITRON_RELEASE_VERSION: value })).toThrow(
        `Not a release version: ${value}`,
      );
    },
  );

  it.each([
    ["1.2.3"],
    ["0.0.0"],
    [LONGEST_RELEASE],
    [TOO_LONG_RELEASE],
    ["1.2"],
    ["1.2.3.4"],
    ["01.2.3"],
    ["1.02.3"],
    ["1.2.03"],
    ["v1.2.3"],
    ["1.2.3-rc1"],
    ["1.2.3\n"],
    [" 1.2.3"],
  ])("answers %j as the reader's isReleaseVersion does", (value) => {
    let stamped;
    try {
      releaseDefine({ WAITRON_RELEASE_VERSION: value });
      stamped = true;
    } catch {
      stamped = false;
    }
    expect(stamped).toBe(isReleaseVersion(value));
  });

  it.each([
    [null, "null"],
    ["1.2.3", '{"version":"1.2.3"}'],
  ])("stamps a bundle given the release version %j", (releaseVersion, literal) => {
    const calls = [];
    bundle(parsePairs(["a.ts=dist/a.js"]), {
      run: (_command, args) => calls.push(args),
      writeNotices: () => {},
      releaseVersion,
    });
    expect(calls[0]).toContain("--define:__WAITRON_RELEASE_VERSION__=__waitronReleaseVersion");
    expect(calls[0].find((arg) => arg.startsWith("--banner:js="))).toContain(
      `\nconst __waitronReleaseVersion = Object.freeze(${literal});`,
    );
  });

  it("leaves a bundle given no release version unstamped", () => {
    const calls = [];
    bundle(parsePairs(["a.ts=dist/a.js"]), {
      run: (_command, args) => calls.push(args),
      writeNotices: () => {},
    });
    expect(calls[0].some((arg) => arg.includes("__WAITRON_RELEASE_VERSION__"))).toBe(false);
    expect(calls[0].some((arg) => arg.includes("__waitronReleaseVersion"))).toBe(false);
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
      writeFileSync(
        join(dir, "entry.ts"),
        `
export const load = () => import("sharp");
export const provenance = {
  hour: typeof __WAITRON_HOUR_RELEASE__ === "undefined" ? null : __WAITRON_HOUR_RELEASE__,
  runtime: typeof __WAITRON_BACKUP_VERIFICATION_RUNTIME__ === "undefined" ? null : __WAITRON_BACKUP_VERIFICATION_RUNTIME__,
  release: typeof __WAITRON_RELEASE_VERSION__ === "undefined" ? "unstamped" : __WAITRON_RELEASE_VERSION__,
};
`,
      );
      const result = runBundleCommand(dir, "entry.ts=dist/out.js", {
        WAITRON_RELEASE_VERSION: "1.2.3",
      });
      expect(result.status, result.stderr).toBe(0);
      const output = readFileSync(join(dir, "dist/out.js"), "utf8");
      expect(output).toContain('import("sharp")');
      expect(
        output.startsWith("import { createRequire as __waitronCreateRequire } from 'node:module';"),
      ).toBe(true);
      const inspect = join(dir, "dist/inspect.mjs");
      copyFileSync(join(dir, "dist/out.js"), inspect);
      const loaded = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `const entry = await import(${JSON.stringify(pathToFileURL(inspect).href)}); console.log(JSON.stringify(entry.provenance));`,
        ],
        { encoding: "utf8", timeout: 10_000 },
      );
      expect(loaded.status, loaded.stderr).toBe(0);
      expect(JSON.parse(loaded.stdout)).toEqual({
        hour: null,
        runtime: null,
        release: { version: "1.2.3" },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 40_000);

  it("refuses a malformed release version on the command line before bundling", () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-bundle-release-"));
    try {
      writeFileSync(join(dir, "entry.ts"), "export {};\n");
      const built = runBundleCommand(dir, "entry.ts=dist/out.mjs", {
        WAITRON_RELEASE_VERSION: "v1.2.3",
      });
      expect(built.status).toBe(1);
      expect(built.stderr).toContain("Not a release version: v1.2.3");
      expect(existsSync(join(dir, "dist/out.mjs"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 40_000);

  it("loads a real bundle whose entry imports createRequire and also uses the CommonJS shim", () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-bundle-load-"));
    try {
      writeFileSync(
        join(dir, "entry.ts"),
        `import { createRequire } from "node:module";
const ownRequire = createRequire(import.meta.url);
console.log(JSON.stringify({
  entry: ownRequire("node:path").basename("/invoice.pdf"),
  shim: require("node:path").extname("/invoice.pdf"),
  release: typeof __WAITRON_RELEASE_VERSION__ === "undefined" ? "unstamped" : __WAITRON_RELEASE_VERSION__,
}));
`,
      );
      const built = runBundleCommand(dir, "entry.ts=dist/out.mjs");
      expect(built.status, built.stderr).toBe(0);
      const loaded = spawnSync(process.execPath, [join(dir, "dist/out.mjs")], {
        encoding: "utf8",
        timeout: 10_000,
      });
      expect(loaded.status, loaded.stderr).toBe(0);
      expect(JSON.parse(loaded.stdout)).toEqual({
        entry: "invoice.pdf",
        shim: ".pdf",
        release: null,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 40_000);

  it("writes the bundled package's licence beside a real node bundle", () => {
    const dir = mkdtempSync(join(tmpdir(), "waitron-bundle-notice-"));
    try {
      mkdirSync(join(dir, "node_modules"));
      symlinkSync(
        realpathSync(join(ROOT, "apps/server/node_modules/hono")),
        join(dir, "node_modules/hono"),
      );
      writeFileSync(
        join(dir, "entry.ts"),
        'import { Hono } from "hono"; export const app = new Hono();\n',
      );
      const result = runBundleCommand(dir, "entry.ts=dist/out.js");
      expect(result.status, result.stderr).toBe(0);
      const notice = readFileSync(join(dir, "dist/out.js.NOTICES.txt"), "utf8");
      const { version } = JSON.parse(
        readFileSync(join(ROOT, "apps/server/node_modules/hono/package.json"), "utf8"),
      );
      expect(notice).toContain(`===== hono ${version} — LICENSE =====`);
      expect(notice).toContain(
        readFileSync(join(ROOT, "apps/server/node_modules/hono/LICENSE"), "utf8"),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 40_000);
});
