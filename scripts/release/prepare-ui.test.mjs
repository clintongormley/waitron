import { describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const PREPARATION_TIMEOUT_MS = 1_580_000;
const FIXTURE_TIMEOUT_MS = 1_680_000;

// The parent covers the complete sequence of bounded commands, plus fixture setup and readback.
vi.setConfig({ testTimeout: FIXTURE_TIMEOUT_MS });

const script = resolve(import.meta.dirname, "prepare-ui.mjs");
const gitEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);
const run = (file, args, cwd) =>
  execFileSync(file, args, { cwd, env: gitEnv, encoding: "utf8", timeout: 10000 });

async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(), "ui-stage-test-"));
  const checkout = join(root, "source");
  const output = join(root, "output");
  await mkdir(join(checkout, "packages/ui-core/dist"), { recursive: true });
  await mkdir(output);
  const manifest = {
    name: "@waitron/ui-core",
    version: "0.1.0",
    private: true,
    type: "module",
    license: "SEE LICENSE IN dist/LICENSE",
    files: ["dist"],
    scripts: { build: 'node -e ""', prepack: 'node -e ""' },
    devDependencies: { unused: "1.0.0" },
    peerDependencies: { lit: "^3.2.0" },
    sideEffects: true,
    exports: { ".": "./src/index.ts" },
    publishConfig: { exports: { ".": { import: "./dist/index.js", types: "./dist/index.d.ts" } } },
  };
  for (const notice of ["LICENSE", "LICENSE-GRANTS.md"]) {
    await writeFile(join(checkout, notice), `fixture ${notice}\n`);
    await writeFile(join(checkout, "packages/ui-core/dist", notice), `fixture ${notice}\n`);
  }
  await writeFile(join(checkout, "packages/ui-core/dist/index.js"), "export const value = 42;\n");
  await writeFile(
    join(checkout, "packages/ui-core/dist/index.d.ts"),
    "export declare const value = 42;\n",
  );
  await writeFile(join(checkout, "packages/ui-core/package.json"), JSON.stringify(manifest));
  run("git", ["init", "-q"], checkout);
  run("git", ["add", "."], checkout);
  run(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "-qm",
      "fixture",
      "--no-gpg-sign",
    ],
    checkout,
  );
  const commit = run("git", ["rev-parse", "HEAD"], checkout).trim();
  const invoke = (extra = [], changes = {}) => {
    const flags = new Map([
      ["--release-version", "0.2.0"],
      ["--source-commit", commit],
    ]);
    for (let i = 0; i < extra.length; i += 2) flags.set(extra[i], extra[i + 1]);
    return spawnSync(process.execPath, [script, checkout, output, ...[...flags].flat()], {
      env: gitEnv,
      encoding: "utf8",
      timeout: PREPARATION_TIMEOUT_MS,
      ...changes,
    });
  };
  try {
    await fn({ root, checkout, output, commit, manifest, invoke });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("UI release preparation", () => {
  it("packs a distinct release identity, exact source and notices without source edits", async () => {
    await fixture(async ({ checkout, output, commit, invoke }) => {
      const result = invoke();
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      const tarball = join(output, "waitron-io-ui-core-0.2.0.tgz");
      const manifest = JSON.parse(run("tar", ["-xOf", tarball, "package/package.json"], output));
      expect(manifest.name).toBe("@waitron-io/ui-core");
      expect(manifest.version).toBe("0.2.0");
      expect(manifest.waitronSource).toEqual({
        repository: "clintongormley/waitron",
        commit,
        version: "0.1.0",
      });
      expect(manifest.publishConfig).toEqual({
        registry: "https://npm.pkg.github.com",
        access: "restricted",
      });
      expect(manifest.peerDependencies).toEqual({ lit: "^3.2.0" });
      expect(manifest.exports).toEqual({
        ".": { import: "./dist/index.js", types: "./dist/index.d.ts" },
      });
      for (const key of ["private", "scripts", "devDependencies"])
        expect(manifest).not.toHaveProperty(key);
      expect(manifest.license).toBe("SEE LICENSE IN dist/LICENSE");
      for (const notice of ["LICENSE", "LICENSE-GRANTS.md"])
        expect(run("tar", ["-xOf", tarball, `package/dist/${notice}`], output)).toBe(
          `fixture ${notice}\n`,
        );
      const receipt = JSON.parse(await readFile(join(output, "preparation.json"), "utf8"));
      expect(receipt.source).toEqual(manifest.waitronSource);
      expect(receipt.releaseVersion).toBe("0.2.0");
      expect(receipt.tarball.sha512).toMatch(/^[a-f0-9]{128}$/);
      expect(run("git", ["status", "--porcelain"], checkout)).toBe("");
      expect(
        JSON.parse(await readFile(join(checkout, "packages/ui-core/package.json"), "utf8")).private,
      ).toBe(true);
    });
  });

  it.each([
    [
      "a different source commit",
      async () => {},
      ["--source-commit", "a".repeat(40)],
      /source commit/,
    ],
    [
      "an invalid release version",
      async () => {},
      ["--release-version", "../escape"],
      /release version/,
    ],
    [
      "untracked source",
      async ({ checkout }) => writeFile(join(checkout, "extra"), "dirty"),
      [],
      /clean/,
    ],
    [
      "occupied output",
      async ({ output }) => writeFile(join(output, "keep"), "retained"),
      [],
      /empty/,
    ],
    [
      "a changed source commit",
      async ({ checkout }) => {
        await writeFile(join(checkout, "packages/ui-core/dist/LICENSE"), "wrong");
        run("git", ["add", "."], checkout);
        run(
          "git",
          [
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.test",
            "commit",
            "-qm",
            "change",
            "--no-gpg-sign",
          ],
          checkout,
        );
      },
      [],
      /source commit/,
    ],
  ])("refuses %s before delivering an artifact", async (_name, change, args, pattern) => {
    await fixture(async (context) => {
      await change(context);
      const result = context.invoke(args);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(pattern);
      expect((await readdir(context.output)).filter((file) => file.endsWith(".tgz"))).toEqual([]);
    });
  });
});

const { releaseManifest, prepareUi, main } = await import("./prepare-ui.mjs");
const source = { repository: "clintongormley/waitron", commit: "b".repeat(40), version: "0.1.0" };
const packed = {
  name: "@waitron/ui-core",
  version: "0.1.0",
  private: true,
  license: "SEE LICENSE IN dist/LICENSE",
  peerDependencies: { lit: "^3.2.0" },
  exports: {
    ".": { import: "./dist/index.js", types: "./dist/index.d.ts" },
    "./tokens.css": "./dist/tokens.css",
  },
};

describe("release manifest refusals", () => {
  it.each([
    [{ ...packed, name: "wrong" }, source, /package name/],
    [{ ...packed, version: "0.9.0" }, source, /source version/],
    [packed, { ...source, repository: "other/repo" }, /source repository/],
    [packed, { ...source, commit: "short" }, /full SHA/],
    [{ ...packed, dependencies: { sibling: "workspace:*" } }, source, /runtime dependencies/],
    [{ ...packed, peerDependencies: {} }, source, /Lit/],
    [{ ...packed, license: "MIT" }, source, /licence/],
    [{ ...packed, exports: {} }, source, /built exports/],
    [
      { ...packed, exports: { ".": { import: "./src/index.ts", types: "./dist/index.d.ts" } } },
      source,
      /built exports/,
    ],
    [
      {
        ...packed,
        exports: { ".": { import: "./dist/../secret.js", types: "./dist/index.d.ts" } },
      },
      source,
      /built exports/,
    ],
  ])("rejects invalid packed metadata %#", (manifest, record, error) => {
    expect(() => releaseManifest(manifest, record, "0.2.0")).toThrow(error);
  });
  it("retains CSS subpaths and leaves input metadata untouched", () => {
    const result = releaseManifest(packed, source, "0.2.0");
    expect(result.exports["./tokens.css"]).toBe("./dist/tokens.css");
    expect(packed.private).toBe(true);
    expect(packed.version).toBe("0.1.0");
  });
});

it("prepares reproducible bytes and independently checked integrity through the library", async () => {
  const { createHash } = await import("node:crypto");
  await fixture(async ({ checkout, output, commit, root }) => {
    const first = await prepareUi({
      checkout,
      output,
      releaseVersion: "0.2.0",
      sourceCommit: commit,
    });
    const bytes = await readFile(join(output, first.tarball.filename));
    expect(first.tarball.sha512).toBe(createHash("sha512").update(bytes).digest("hex"));
    expect(first.tarball.integrity).toBe(
      `sha512-${createHash("sha512").update(bytes).digest("base64")}`,
    );
    const secondOutput = join(root, "second");
    await mkdir(secondOutput);
    const second = await main([
      checkout,
      secondOutput,
      "--source-commit",
      commit,
      "--release-version",
      "0.2.0",
    ]);
    expect(await readFile(join(secondOutput, second.tarball.filename))).toEqual(bytes);
    expect(second).toEqual(first);
    expect(await readdir(output)).toEqual(["preparation.json", first.tarball.filename].sort());
  });
});

it.each([
  [[]],
  [["source", "output"]],
  [["source", "output", "--unknown", "1", "--source-commit", "a".repeat(40)]],
])("refuses incomplete or unknown CLI arguments %#", async (args) => {
  await expect(main(args)).rejects.toThrow(/Usage|are required/);
});

it.each([
  ["missing export", "packages/ui-core/dist/index.js", null, /ENOENT/],
  ["changed packed notice", "packages/ui-core/dist/LICENSE", "changed", /differs from source/],
  ["missing packed notice", "packages/ui-core/dist/LICENSE-GRANTS.md", null, /ENOENT/],
  [
    "wrong package",
    "packages/ui-core/package.json",
    JSON.stringify({ ...packed, name: "wrong" }),
    /package name/,
  ],
])("refuses %s using the actual committed source", async (_name, path, content, error) => {
  await fixture(async ({ checkout, output }) => {
    if (content === null) await rm(join(checkout, path));
    else await writeFile(join(checkout, path), content);
    run("git", ["add", "."], checkout);
    run(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "-qm",
        "change",
        "--no-gpg-sign",
      ],
      checkout,
    );
    const commit = run("git", ["rev-parse", "HEAD"], checkout).trim();
    await expect(
      prepareUi({ checkout, output, releaseVersion: "0.2.0", sourceCommit: commit }),
    ).rejects.toThrow(error);
    expect(await readdir(output)).toEqual([]);
  });
});

it("rejects output inside the checkout, including a clean ignored directory", async () => {
  await fixture(async ({ checkout, commit }) => {
    await mkdir(join(checkout, ".git/output"));
    await expect(
      prepareUi({
        checkout,
        output: join(checkout, ".git/output"),
        releaseVersion: "0.2.0",
        sourceCommit: commit,
      }),
    ).rejects.toThrow(/outside/);
  });
});

it.each([
  ["optionalDependencies", { sibling: "workspace:*" }],
  ["bundledDependencies", ["lit"]],
])("refuses hidden runtime dependencies in %s", (key, value) => {
  expect(() => releaseManifest({ ...packed, [key]: value }, source, "0.2.0")).toThrow(
    /runtime dependencies/,
  );
});

it("records input and recipe hashes for the separately selected source", async () => {
  await fixture(async ({ checkout, output, commit }) => {
    const receipt = await prepareUi({
      checkout,
      output,
      sourceCommit: commit,
      releaseVersion: "0.2.0",
    });
    const { createHash } = await import("node:crypto");
    expect(receipt.inputs?.["packages/ui-core/package.json"]).toBe(
      createHash("sha512")
        .update(await readFile(join(checkout, "packages/ui-core/package.json")))
        .digest("hex"),
    );
    expect(receipt.recipeSha512).toBe(
      createHash("sha512")
        .update(await readFile(script))
        .digest("hex"),
    );
    expect(receipt.toolchain.node).toBe(process.version);
    expect(receipt.toolchain.pnpm).toMatch(/^9\./);
  });
});

it("refuses a stale nested copy inheriting its parent's Git identity", async () => {
  await fixture(async ({ checkout, output, commit }) => {
    const copy = join(checkout, "copy");
    await cp(join(checkout, "packages"), join(copy, "packages"), { recursive: true });
    for (const notice of ["LICENSE", "LICENSE-GRANTS.md"])
      await cp(join(checkout, notice), join(copy, notice));
    await writeFile(join(checkout, ".git/info/exclude"), "copy/\n");
    await expect(
      prepareUi({ checkout: copy, output, sourceCommit: commit, releaseVersion: "0.2.0" }),
    ).rejects.toThrow(/top.level/);
    expect(await readdir(output)).toEqual([]);
  });
});

it.each(["npm_config_ignore_scripts", "NPM_CONFIG_IGNORE_SCRIPTS"])(
  "rebuilds stale ignored output despite %s",
  async (key) => {
    await fixture(async ({ checkout, output, manifest, invoke }) => {
      await writeFile(join(checkout, ".gitignore"), "packages/ui-core/dist/\n");
      run("git", ["rm", "-r", "--cached", "packages/ui-core/dist"], checkout);
      const build =
        'node -e \'require("node:fs").writeFileSync("dist/index.js", "export const value = 43;\\n")\'';
      await writeFile(
        join(checkout, "packages/ui-core/package.json"),
        JSON.stringify({ ...manifest, scripts: { build, prepack: "pnpm run build" } }),
      );
      run("git", ["add", "."], checkout);
      run(
        "git",
        [
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.test",
          "commit",
          "-qm",
          "new build",
          "--no-gpg-sign",
        ],
        checkout,
      );
      const commit = run("git", ["rev-parse", "HEAD"], checkout).trim();
      const result = invoke(["--source-commit", commit], { env: { ...gitEnv, [key]: "true" } });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(
        run(
          "tar",
          ["-xOf", join(output, "waitron-io-ui-core-0.2.0.tgz"), "package/dist/index.js"],
          output,
        ),
      ).toBe("export const value = 43;\n");
    });
  },
);

it("refuses a source edit hidden from git status", async () => {
  await fixture(async ({ checkout, output, commit }) => {
    run("git", ["update-index", "--assume-unchanged", "packages/ui-core/package.json"], checkout);
    await writeFile(join(checkout, "packages/ui-core/package.json"), "{}");
    expect(run("git", ["status", "--porcelain"], checkout)).toBe("");
    await expect(
      prepareUi({ checkout, output, sourceCommit: commit, releaseVersion: "0.2.0" }),
    ).rejects.toThrow(/index flags/);
  });
});

it("releases its output lock if creating scratch space fails", async () => {
  await fixture(async ({ root, output, invoke }) => {
    const file = join(root, "not-a-directory");
    await writeFile(file, "retain");
    const result = invoke([], { env: { ...gitEnv, TMPDIR: file } });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/ENOTDIR/);
    expect(await readdir(output)).toEqual([]);
  });
});

it("prepares identical bytes under a restrictive file creation mask", async () => {
  await fixture(async ({ root, checkout, output, commit }) => {
    const first = await prepareUi({
      checkout,
      output,
      sourceCommit: commit,
      releaseVersion: "0.2.0",
    });
    const secondOutput = join(root, "restrictive");
    await mkdir(secondOutput);
    const previous = process.umask(0o077);
    try {
      const second = await prepareUi({
        checkout,
        output: secondOutput,
        sourceCommit: commit,
        releaseVersion: "0.2.0",
      });
      expect(await readFile(join(secondOutput, second.tarball.filename))).toEqual(
        await readFile(join(output, first.tarball.filename)),
      );
    } finally {
      process.umask(previous);
    }
  });
});

it("selects the real UI consumer when only the preparation script changes", async () => {
  const { scopeForPaths } = await import("../changed-packages.mjs");
  const scope = scopeForPaths(["scripts/release/prepare-ui.mjs"], () => [
    { name: "@waitron/ui-core", dir: "packages/ui-core" },
  ]);
  expect(scope.kind).toBe("packages");
  expect(scope.packages).toEqual(["@waitron/ui-core"]);
});

it.each([[{ ".": { import: "./dist/index.js" } }, /built exports/]])(
  "requires declaration export targets %#",
  (exports, error) => {
    expect(() => releaseManifest({ ...packed, exports }, source, "0.2.0")).toThrow(error);
  },
);
it("refuses the alternative bundled-dependency spelling", () => {
  expect(() =>
    releaseManifest({ ...packed, bundleDependencies: ["lit"] }, source, "0.2.0"),
  ).toThrow(/runtime dependencies/);
});

it("preserves repository and homepage provenance", () => {
  const result = releaseManifest(packed, source, "0.2.1");
  expect(result.repository).toEqual({
    type: "git",
    url: "https://github.com/waitron-io/waitron-cloud.git",
  });
  expect(result.homepage).toBe(
    `https://github.com/clintongormley/waitron/tree/${"b".repeat(40)}/packages/ui-core`,
  );
});

it("records independently checked manifest and notice hashes", async () => {
  const { createHash } = await import("node:crypto");
  await fixture(async ({ checkout, output, commit }) => {
    const receipt = await prepareUi({
      checkout,
      output,
      sourceCommit: commit,
      releaseVersion: "0.2.0",
    });
    const tarball = join(output, receipt.tarball.filename);
    const hashText = (text) => createHash("sha512").update(text).digest("hex");
    expect(receipt.manifestSha512).toBe(
      hashText(run("tar", ["-xOf", tarball, "package/package.json"], output)),
    );
    expect(receipt.notices).toEqual({
      LICENSE: hashText("fixture LICENSE\n"),
      "LICENSE-GRANTS.md": hashText("fixture LICENSE-GRANTS.md\n"),
    });
  });
});

it("delivers registry imports and an absolute source-guide link in the README", async () => {
  await fixture(async ({ checkout, output, commit }) => {
    const receipt = await prepareUi({
      checkout,
      output,
      sourceCommit: commit,
      releaseVersion: "0.2.1",
    });
    const readme = run(
      "tar",
      ["-xOf", join(output, receipt.tarball.filename), "package/README.md"],
      output,
    );
    expect(readme).toContain('import "@waitron-io/ui-core/components/wt-input"');
    expect(readme).toContain(
      `https://github.com/clintongormley/waitron/blob/${commit}/packages/ui-core/README.md`,
    );
    expect(readme).toContain("dist/LICENSE-GRANTS.md");
  });
});

async function buildFixture(context, code) {
  await writeFile(join(context.checkout, "packages/ui-core/build.mjs"), code);
  await writeFile(
    join(context.checkout, "packages/ui-core/package.json"),
    JSON.stringify({ ...context.manifest, scripts: { build: "node build.mjs" } }),
  );
  run("git", ["add", "."], context.checkout);
  run(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "-qm",
      "build fixture",
      "--no-gpg-sign",
    ],
    context.checkout,
  );
  return run("git", ["rev-parse", "HEAD"], context.checkout).trim();
}

it("keeps credentials and Git overrides out of the real build child", async () => {
  await fixture(async (context) => {
    await writeFile(
      join(context.checkout, ".git/info/exclude"),
      "packages/ui-core/dist/env.json\n",
    );
    const keys = [
      "NPM_CONFIG__AUTH",
      "NPM_CONFIG_USERCONFIG",
      "AWS_ACCESS_KEY_ID",
      "GH_PAT",
      "API_KEY",
      "SSH_AUTH_SOCK",
      "NODE_AUTH_TOKEN",
      "GIT_DIR",
    ];
    const commit = await buildFixture(
      context,
      `import { writeFileSync } from "node:fs"; writeFileSync("dist/env.json", JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map(key => [key, process.env[key] ?? null]))));`,
    );
    const result = context.invoke(["--source-commit", commit], {
      env: { ...gitEnv, ...Object.fromEntries(keys.map((key) => [key, "FAKE_SENTINEL"])) },
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const value = JSON.parse(
      run(
        "tar",
        ["-xOf", join(context.output, "waitron-io-ui-core-0.2.0.tgz"), "package/dist/env.json"],
        context.output,
      ),
    );
    expect(value).toEqual(Object.fromEntries(keys.map((key) => [key, null])));
  });
});

it("refuses changes to tracked files made during the build", async () => {
  await fixture(async (context) => {
    const commit = await buildFixture(
      context,
      'import { appendFileSync } from "node:fs"; appendFileSync("package.json", " ");',
    );
    await expect(
      prepareUi({ ...context, sourceCommit: commit, releaseVersion: "0.2.0" }),
    ).rejects.toThrow(/must be clean/);
    expect(await readdir(context.output)).toEqual([]);
  });
});

it("refuses a clean but different commit created during the build", async () => {
  await fixture(async (context) => {
    const commit = await buildFixture(
      context,
      `import { writeFileSync } from "node:fs"; import { execFileSync } from "node:child_process"; writeFileSync("marker", "changed"); execFileSync("git", ["add", "."]); execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "changed", "--no-gpg-sign"]);`,
    );
    await expect(
      prepareUi({ ...context, sourceCommit: commit, releaseVersion: "0.2.0" }),
    ).rejects.toThrow(/build changed source commit/);
    expect(await readdir(context.output)).toEqual([]);
  });
});

it("allows only one build for simultaneous preparations into one output", async () => {
  await fixture(async (context) => {
    const marker = join(context.root, "builds");
    const commit = await buildFixture(
      context,
      `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(marker)}, "built\\n");`,
    );
    const options = { ...context, sourceCommit: commit, releaseVersion: "0.2.0" };
    const results = await Promise.allSettled([prepareUi(options), prepareUi(options)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await readFile(marker, "utf8")).toBe("built\n");
    expect((await readdir(context.output)).sort()).toEqual([
      "preparation.json",
      "waitron-io-ui-core-0.2.0.tgz",
    ]);
  });
});

it.each(["preparation.json", "waitron-io-ui-core-0.2.0.tgz"])(
  "preserves a foreign %s created during the build",
  async (filename) => {
    await fixture(async (context) => {
      const target = join(context.output, filename);
      const commit = await buildFixture(
        context,
        `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(target)}, "foreign");`,
      );
      await expect(
        prepareUi({ ...context, sourceCommit: commit, releaseVersion: "0.2.0" }),
      ).rejects.toThrow(/EEXIST/);
      expect(await readFile(target, "utf8")).toBe("foreign");
      expect(await readdir(context.output)).toEqual([filename]);
    });
  },
);

it("records the selected lockfile and CI workflow contents", async () => {
  const { createHash } = await import("node:crypto");
  await fixture(async (context) => {
    await mkdir(join(context.checkout, ".github/workflows"), { recursive: true });
    const lockfile = "lockfileVersion: '9.0'\n";
    const workflow = "name: fixture\n";
    await writeFile(join(context.checkout, "pnpm-lock.yaml"), lockfile);
    await writeFile(join(context.checkout, ".github/workflows/ci.yml"), workflow);
    const commit = await buildFixture(context, "");
    const receipt = await prepareUi({ ...context, sourceCommit: commit, releaseVersion: "0.2.0" });
    expect(receipt.inputs["pnpm-lock.yaml"]).toBe(
      createHash("sha512").update(lockfile).digest("hex"),
    );
    expect(receipt.inputs[".github/workflows/ci.yml"]).toBe(
      createHash("sha512").update(workflow).digest("hex"),
    );
  });
});

it("collects temporary build files after a successful preparation", async () => {
  await fixture(async (context) => {
    const scratch = join(context.root, "scratch");
    await mkdir(scratch);
    const result = context.invoke([], { env: { ...gitEnv, TMPDIR: scratch } });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect((await readdir(scratch)).filter((name) => name.startsWith("waitron-ui-stage-"))).toEqual(
      [],
    );
  });
});

it("refuses an export that resolves to a directory", async () => {
  await fixture(async (context) => {
    const path = join(context.checkout, "packages/ui-core/dist/index.js");
    await rm(path);
    await mkdir(path);
    await writeFile(join(path, "child.js"), "export {};\n");
    const commit = await buildFixture(context, "");
    await expect(
      prepareUi({ ...context, sourceCommit: commit, releaseVersion: "0.2.0" }),
    ).rejects.toThrow(/must be a staged file/);
    expect(await readdir(context.output)).toEqual([]);
  });
});

it("prepares contract metadata with no peers and preserves the UI policy", () => {
  const contract = {
    ...packed,
    name: "@waitron/contract",
    sideEffects: false,
    peerDependencies: {},
    exports: { ".": packed.exports["."] },
  };
  const result = releaseManifest(contract, source, "0.2.7", "contract");
  expect(result.name).toBe("@waitron-io/contract");
  expect(result.homepage).toBe(
    `https://github.com/clintongormley/waitron/tree/${source.commit}/packages/contract`,
  );
  expect(result.peerDependencies).toEqual({});
  expect(result.sideEffects).toBe(false);
  expect(() =>
    releaseManifest(
      { ...contract, peerDependencies: { lit: "^3.2.0" } },
      source,
      "0.2.7",
      "contract",
    ),
  ).toThrow(/peer/);
  expect(() =>
    releaseManifest({ ...contract, sideEffects: true }, source, "0.2.7", "contract"),
  ).toThrow(/side effects/);
  expect(() => releaseManifest(contract, source, "0.2.7", "../other")).toThrow(/package/);
  expect(releaseManifest(packed, source, "0.2.7").peerDependencies).toEqual({ lit: "^3.2.0" });
});
