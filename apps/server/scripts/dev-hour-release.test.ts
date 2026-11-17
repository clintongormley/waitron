import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url));
const preload = fileURLToPath(new URL("./dev-hour-release.mjs", import.meta.url));
const hourRelease = fileURLToPath(
  new URL("../../../packages/fiscal-verifactu/src/hour-release.ts", import.meta.url),
);
const STAMP = {
  sourceCommit: "a".repeat(40),
  committedAt: "2026-11-17T12:00:00.000Z",
  instantMs: Date.parse("2026-11-17T12:00:00.000Z"),
  generator: "scripts/generate-hour-release.mjs:v1",
  generatorSha256: "b".repeat(64),
};

describe("dev-hour-release preload", () => {
  let workDir: string;
  let reader: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "waitron-dev-hour-release-"));
    reader = join(workDir, "read.ts");
    await writeFile(
      reader,
      `import { readHourRelease } from ${JSON.stringify(pathToFileURL(hourRelease).href)};\n` +
        "console.log(JSON.stringify(readHourRelease()));\n",
    );
  });

  afterAll(async () => {
    if (workDir !== undefined) await rm(workDir, { recursive: true, force: true });
  });

  /** Runs the real fiscal reader from source, as a `tsx` start does, and returns what it read. */
  function read(options: { preload: boolean; stamp?: string }): unknown {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.WAITRON_DEV_HOUR_RELEASE;
    if (options.stamp !== undefined) env.WAITRON_DEV_HOUR_RELEASE = options.stamp;
    const result = spawnSync(
      process.execPath,
      ["--import=tsx", ...(options.preload ? [`--import=${preload}`] : []), reader],
      { cwd: pkgRoot, encoding: "utf8", timeout: 30_000, env },
    );
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout);
  }

  it("gives the source run the launcher's stamp", () => {
    expect(read({ preload: true, stamp: JSON.stringify(STAMP) })).toEqual(STAMP);
  });

  it("leaves a plain source start without a stamp even when the variable is set", () => {
    expect(read({ preload: false, stamp: JSON.stringify(STAMP) })).toBeNull();
  });

  it("sets nothing when the launcher handed no stamp", () => {
    expect(read({ preload: true })).toBeNull();
  });

  it("sets nothing when the handed stamp is not JSON", () => {
    expect(read({ preload: true, stamp: "{not json" })).toBeNull();
  });
});
