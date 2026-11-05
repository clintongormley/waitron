import { describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

vi.setConfig({ testTimeout: 180000 });

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
    scripts: { prepack: 'node -e ""' },
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
      timeout: 20000,
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
      "changed notices",
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
