import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { generateHourRelease, readBuildHourRelease } from "./generate-hour-release.mjs";
import { bundle } from "./bundle-node.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);
const temporaryDirectories = [];
afterAll(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
});
function temporaryDirectory() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "waitron-hour-release-")));
  temporaryDirectories.push(directory);
  return directory;
}
function git(cwd, args, env = {}) {
  return execFileSync("git", args, {
    cwd,
    env: { ...environment, ...env },
    encoding: "utf8",
    timeout: 10_000,
  }).trim();
}
function fixture() {
  const cwd = temporaryDirectory();
  git(cwd, ["init", "-q"]);
  git(cwd, ["config", "user.name", "Release fixture"]);
  git(cwd, ["config", "user.email", "release@example.invalid"]);
  git(cwd, ["config", "commit.gpgsign", "false"]);
  const hashes = [];
  for (const [index, instant] of ["2026-10-14T10:00:00Z", "2026-10-15T11:00:00Z"].entries()) {
    writeFileSync(join(cwd, "source.txt"), String(index));
    git(cwd, ["add", "source.txt"]);
    git(cwd, ["commit", "-s", "-qm", `Source ${index}`], {
      GIT_AUTHOR_DATE: instant,
      GIT_COMMITTER_DATE: instant,
    });
    hashes.push(git(cwd, ["rev-parse", "HEAD"]));
  }
  return { cwd, hashes };
}

describe("release metadata is a build product of a pinned source commit", () => {
  it("resolves each exact revision's full SHA and committer time", () => {
    const { cwd, hashes } = fixture();
    const first = generateHourRelease({ cwd, source: hashes[0] });
    const second = generateHourRelease({ cwd, source: hashes[1] });
    expect(first).toMatchObject({
      sourceCommit: hashes[0],
      committedAt: "2026-10-14T10:00:00.000Z",
      instantMs: 1791972000000,
      generator: "scripts/generate-hour-release.mjs:v1",
    });
    expect(second).toMatchObject({
      sourceCommit: hashes[1],
      committedAt: "2026-10-15T11:00:00.000Z",
      instantMs: 1792062000000,
    });
    expect(first.generatorSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each(["", "HEAD", "--help", "a".repeat(39), "g".repeat(40), "a".repeat(40)])(
    "refuses invalid or unknown pinned source %s",
    (source) => {
      const { cwd } = fixture();
      expect(() => generateHourRelease({ cwd, source })).toThrow();
    },
  );

  it("a rebuild in a Git checkout ignores a stale earlier generated stamp", () => {
    const { cwd, hashes } = fixture();
    mkdirSync(join(cwd, "build"));
    writeFileSync(
      join(cwd, "build/hour-release.json"),
      JSON.stringify(generateHourRelease({ cwd, source: hashes[0] })),
    );
    expect(readBuildHourRelease({ cwd }).sourceCommit).toBe(hashes[1]);
  });

  it("the Git-less image generator fetches the exact pinned revision, independently of an install clock", () => {
    const { cwd, hashes } = fixture();
    const stamp = generateHourRelease({
      source: hashes[0],
      fetchSource: true,
      run: (command, args, options) => {
        const local =
          args[0] === "fetch"
            ? args.map((arg) =>
                arg === "https://github.com/clintongormley/waitron.git" ? cwd : arg,
              )
            : args;
        return execFileSync(command, local, options);
      },
    });
    expect(stamp).toMatchObject({
      sourceCommit: hashes[0],
      committedAt: "2026-10-14T10:00:00.000Z",
      instantMs: 1791972000000,
    });
    const packaged = temporaryDirectory();
    mkdirSync(join(packaged, "build"));
    writeFileSync(join(packaged, "build/hour-release.json"), JSON.stringify(stamp));
    expect(readBuildHourRelease({ cwd: packaged })).toEqual(stamp);
  });

  it("the generator CLI emits the source stamp and refuses an unpinned input", () => {
    const source = git(ROOT, ["rev-parse", "HEAD"]);
    const command = [join(ROOT, "scripts/generate-hour-release.mjs"), "--source"];
    const result = spawnSync(process.execPath, [...command, source], {
      env: environment,
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(generateHourRelease({ source }));
    const refused = spawnSync(process.execPath, [...command, "development"], {
      env: environment,
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(refused.status).toBe(1);
    expect(refused.stdout).toBe("");
  });

  it.each([
    ["b".repeat(40), "1000"],
    ["a".repeat(40), "NaN"],
    ["a".repeat(40), "9000000000000000"],
    ["a".repeat(40), "8640000000001"],
  ])("refuses corrupt Git metadata %s / %s", (resolved, seconds) => {
    expect(() =>
      generateHourRelease({
        source: "a".repeat(40),
        run: (_command, args) => (args[0] === "rev-parse" ? resolved : seconds),
      }),
    ).toThrow();
  });

  it.each([
    { sourceCommit: "bad" },
    { instantMs: 1.5 },
    { instantMs: 9_000_000_000_000_000 },
    { committedAt: "2000-01-01T00:00:00.000Z" },
    { generator: "other" },
    { generatorSha256: "b".repeat(64) },
  ])("refuses corrupted image build metadata %j", (change) => {
    const { cwd, hashes } = fixture();
    const stamp = generateHourRelease({ cwd, source: hashes[0] });
    const packaged = temporaryDirectory();
    mkdirSync(join(packaged, "build"));
    writeFileSync(
      join(packaged, "build/hour-release.json"),
      JSON.stringify({ ...stamp, ...change }),
    );
    expect(() => readBuildHourRelease({ cwd: packaged })).toThrow();
  });

  it("an explicitly unstamped development image supplies no release floor", () => {
    const cwd = temporaryDirectory();
    mkdirSync(join(cwd, "build"));
    writeFileSync(join(cwd, "build/hour-release.json"), "null");
    expect(readBuildHourRelease({ cwd })).toBeNull();
  });

  it("the bundle seam embeds the supplied source floor into a runnable artifact", () => {
    const { cwd, hashes } = fixture();
    const stamp = generateHourRelease({ cwd, source: hashes[0] });
    const entry = join(cwd, "entry.ts");
    const out = join(cwd, "out.mjs");
    writeFileSync(entry, `console.log(JSON.stringify(__WAITRON_HOUR_RELEASE__));`);
    bundle([{ entry, outfile: out }], {
      release: stamp,
      run: (command, args, options) =>
        execFileSync(join(ROOT, "apps/server/node_modules/.bin", command), args, options),
    });
    const result = spawnSync(process.execPath, [out], { encoding: "utf8", timeout: 10_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(stamp);
  });

  it("a Git-less image reads only validated build metadata and missing metadata stays absent", () => {
    const cwd = temporaryDirectory();
    expect(readBuildHourRelease({ cwd })).toBeNull();
    mkdirSync(join(cwd, "build"));
    writeFileSync(join(cwd, "build/hour-release.json"), JSON.stringify({ instantMs: 0 }));
    expect(() => readBuildHourRelease({ cwd })).toThrow();
  });

  // The bound clears every wait at its limit: two 90 s bundles plus a 10 s load per entry per bundle.
  it("the actual bundle command replaces a stale stamp for every declared Node entry", () => {
    const { cwd, hashes } = fixture();
    mkdirSync(join(cwd, "scripts"));
    for (const file of ["bundle-node.mjs", "generate-hour-release.mjs", "npm-bundle-notices.mjs"])
      copyFileSync(join(ROOT, "scripts", file), join(cwd, "scripts", file));
    const manifests = ["apps/server/package.json", "packages/provisioning/package.json"];
    const entries = manifests
      .flatMap((path) => [
        ...JSON.parse(readFileSync(join(ROOT, path), "utf8")).scripts.build.matchAll(
          /(?:\S+)=(dist\/[^ ]+\.js)/g,
        ),
      ])
      .map((match) => match[1]);
    expect(entries).toContain("dist/server.js");
    expect(entries).toContain("dist/node-entry.js");
    expect(entries).toContain("dist/bin-restore.js");
    expect(entries).toContain("dist/register-till.js");
    expect(entries).toContain("dist/bin.js");
    writeFileSync(
      join(cwd, "entry.ts"),
      `import { readHourRelease } from ${JSON.stringify(join(ROOT, "packages/fiscal-verifactu/src/hour-release.ts"))};\nconsole.log(JSON.stringify(readHourRelease()));\n`,
    );
    mkdirSync(join(cwd, "build"));
    const old = generateHourRelease({ cwd, source: hashes[0] });
    writeFileSync(join(cwd, "build/hour-release.json"), JSON.stringify(old));
    const env = {
      ...environment,
      PATH: `${join(ROOT, "apps/server/node_modules/.bin")}${delimiter}${environment.PATH}`,
    };
    for (const [revision, stamp] of [
      [hashes[0], "2026-10-14T10:00:00.000Z"],
      [hashes[1], "2026-10-15T11:00:00.000Z"],
    ]) {
      git(cwd, ["checkout", "-q", "--detach", revision]);
      const result = spawnSync(
        process.execPath,
        [join(cwd, "scripts/bundle-node.mjs"), ...entries.map((out) => `entry.ts=${out}`)],
        { cwd, env, encoding: "utf8", timeout: 90_000 },
      );
      expect(result.status, result.stderr).toBe(0);
      for (const out of entries) {
        const executable = join(cwd, `${out}.mjs`);
        copyFileSync(join(cwd, out), executable);
        utimesSync(executable, new Date(0), new Date(0));
        const loaded = spawnSync(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `Date.now=()=>0; await import(${JSON.stringify(executable)});`,
          ],
          {
            cwd,
            env: { ...env, WAITRON_BUILD_ID: "old", WAITRON_IMAGE_CREATED: "1970-01-01T00:00:00Z" },
            encoding: "utf8",
            timeout: 10_000,
          },
        );
        expect(loaded.status, loaded.stderr).toBe(0);
        expect(JSON.parse(loaded.stdout)).toMatchObject({
          sourceCommit: revision,
          committedAt: stamp,
        });
      }
    }
  }, 400_000);
});
