import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 120_000 });

const ROOT = resolve(import.meta.dirname, "..");
const environment = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
);
const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
const directories = [];
afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
});
function directory() {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "waitron-image-release-")));
  directories.push(path);
  return path;
}
function git(cwd, ...args) {
  return execFileSync(realGit, args, {
    cwd,
    env: environment,
    encoding: "utf8",
    timeout: 10_000,
  }).trim();
}
function fixture() {
  const source = directory();
  git(source, "init", "-q");
  writeFileSync(join(source, "content"), "source\n");
  git(source, "add", "content");
  execFileSync(realGit, ["-c", "commit.gpgsign=false", "commit", "-s", "-qm", "Source"], {
    cwd: source,
    env: {
      ...environment,
      GIT_AUTHOR_NAME: "Release fixture",
      GIT_AUTHOR_EMAIL: "release@example.invalid",
      GIT_COMMITTER_NAME: "Release fixture",
      GIT_COMMITTER_EMAIL: "release@example.invalid",
      GIT_AUTHOR_DATE: "2026-10-14T09:00:00Z",
      GIT_COMMITTER_DATE: "2026-10-15T11:00:00Z",
    },
    timeout: 10_000,
  });
  const pinnedSource = git(source, "rev-parse", "HEAD");
  git(
    source,
    "-c",
    "commit.gpgsign=false",
    "-c",
    "user.name=Release fixture",
    "-c",
    "user.email=release@example.invalid",
    "commit",
    "-s",
    "-qm",
    "Later source",
    "--allow-empty",
  );
  const cwd = directory();
  mkdirSync(join(cwd, "scripts"));
  copyFileSync(
    join(ROOT, "scripts/generate-hour-release.mjs"),
    join(cwd, "scripts/generate-hour-release.mjs"),
  );
  const bin = join(cwd, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "git"), `#!/bin/sh\necho forbidden-git >> "$FETCH_LOG"; exit 97\n`);
  chmodSync(join(bin, "git"), 0o755);
  return {
    cwd,
    bin,
    sourceDirectory: source,
    source: pinnedSource,
    log: join(cwd, "fetch.log"),
  };
}
function runStamp(input, buildId, metadata = `${input.source}:1792062000`) {
  const dockerfile = readFileSync(join(ROOT, "deploy/Dockerfile"), "utf8");
  const instruction = dockerfile.match(/^RUN (?:--network=none )?mkdir -p build(?:.*\\\n)*.*$/m);
  if (!instruction) throw new Error("Missing image release generation instruction");
  const script = instruction[0].replace(/^RUN (?:--network=none )?/, "").replace(/\\\n/g, " ");
  return spawnSync("sh", ["-c", script], {
    cwd: input.cwd,
    env: {
      ...environment,
      PATH: `${input.bin}${delimiter}${environment.PATH}`,
      WAITRON_BUILD_ID: buildId,
      FETCH_LOG: input.log,
      WAITRON_SOURCE_METADATA: metadata,
    },
    encoding: "utf8",
    timeout: 10_000,
  });
}

describe("the image release step uses its source context", () => {
  it("prefers an explicit pinned input over a stale metadata file", () => {
    const input = fixture();
    mkdirSync(join(input.cwd, "build"));
    writeFileSync(join(input.cwd, "build/source-metadata"), "stale:0\n");
    const result = runStamp(input, input.source);
    expect(result.status, result.stderr).toBe(0);
    expect(
      JSON.parse(readFileSync(join(input.cwd, "build/hour-release.json"), "utf8")),
    ).toMatchObject({
      sourceCommit: input.source,
      instantMs: 1792062000000,
    });
    expect(existsSync(input.log)).toBe(false);
  });

  it.each([".github/workflows/ci.yml", ".github/workflows/image-smoke.yml"])(
    "%s prepares the requested commit's time, replacing an earlier input",
    (workflow) => {
      const input = fixture();
      const text = readFileSync(join(ROOT, workflow), "utf8");
      const match = text.match(
        / {6}- name: Record image build time\n {8}id: provenance\n {8}run: \|\n((?: {10}.*\n)+)/,
      );
      if (!match) throw new Error("Missing image provenance step");
      const script = match[1].replace(/^ {10}/gm, "");
      mkdirSync(join(input.sourceDirectory, "build"));
      writeFileSync(join(input.sourceDirectory, "build/source-metadata"), "stale:0\n");
      const result = spawnSync("bash", ["-ec", script], {
        cwd: input.sourceDirectory,
        env: {
          ...environment,
          GITHUB_SHA: input.source,
          GITHUB_OUTPUT: join(input.sourceDirectory, "output"),
        },
        encoding: "utf8",
        timeout: 10_000,
      });
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(join(input.sourceDirectory, "build/source-metadata"), "utf8")).toBe(
        `${input.source}:1792062000\n`,
      );
    },
  );

  it("uses the metadata file prepared by CI in the Git-less source context", () => {
    const input = fixture();
    mkdirSync(join(input.cwd, "build"));
    writeFileSync(join(input.cwd, "build/source-metadata"), `${input.source}:1792062000\n`);
    const result = runStamp(input, input.source, "");
    expect(result.status, result.stderr).toBe(0);
    expect(
      JSON.parse(readFileSync(join(input.cwd, "build/hour-release.json"), "utf8")),
    ).toMatchObject({
      sourceCommit: input.source,
      instantMs: 1792062000000,
    });
    expect(existsSync(input.log)).toBe(false);
  });

  it("makes the pinned stamp in a Git-less context with every Git command forbidden", () => {
    const input = fixture();
    const result = runStamp(input, input.source);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(input.cwd, "build/hour-release.json"), "utf8"))).toEqual({
      sourceCommit: input.source,
      committedAt: "2026-10-15T11:00:00.000Z",
      instantMs: 1792062000000,
      generator: "scripts/generate-hour-release.mjs:v1",
      generatorSha256: createHash("sha256")
        .update(readFileSync(join(ROOT, "scripts/generate-hour-release.mjs")))
        .digest("hex"),
    });
    expect(existsSync(input.log)).toBe(false);
  });

  it.each(["", "wrong:1792062000", "a".repeat(40) + ":1792062000", "time:NaN"])(
    "refuses missing or mismatched source metadata %s without Git",
    (metadata) => {
      const input = fixture();
      const result = runStamp(input, input.source, metadata);
      expect(result.status).not.toBe(0);
      expect(existsSync(input.log)).toBe(false);
    },
  );

  it("keeps development builds explicitly unqualified without source metadata", () => {
    const input = fixture();
    const result = runStamp(input, "development", "");
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(input.cwd, "build/hour-release.json"), "utf8"))).toBeNull();
    expect(existsSync(join(input.cwd, ".git"))).toBe(false);
    expect(existsSync(input.log)).toBe(false);
  });
});
