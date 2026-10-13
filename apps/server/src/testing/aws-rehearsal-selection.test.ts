import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const VITEST = join(
  dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
  "vitest.mjs",
);
const REHEARSAL_SUFFIX = ".aws-rehearsal.test.ts";
// Below the package's 120 s testTimeout, so a hung child fails as a timeout here, not as a test kill.
const CHILD_TIMEOUT_MS = 90_000;

function rehearsalFilesOnDisk(dir = join(PACKAGE_DIR, "src")): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return rehearsalFilesOnDisk(path);
    return entry.isFile() && entry.name.endsWith(REHEARSAL_SUFFIX)
      ? [relative(PACKAGE_DIR, path)]
      : [];
  });
}

function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.startsWith("AWS_") || name === "WAITRON_RUN_AWS_REHEARSAL") delete env[name];
  }
  delete env.AI_AGENT;
  delete env.CLAUDECODE;
  return env;
}

function vitest(args: string[], env: NodeJS.ProcessEnv = childEnv()) {
  const result = spawnSync(process.execPath, [VITEST, ...args], {
    cwd: PACKAGE_DIR,
    env,
    encoding: "utf8",
    timeout: CHILD_TIMEOUT_MS,
  });
  if (result.error) throw result.error;
  return result;
}

function listed(config: string): string[] {
  const result = vitest(["list", "--filesOnly", "--json", "--config", config]);
  expect(result.status, result.stderr).toBe(0);
  return (JSON.parse(result.stdout) as { file: string }[])
    .map((entry) => relative(PACKAGE_DIR, entry.file))
    .sort();
}

describe("AWS rehearsal test selection", () => {
  it("finds at least one rehearsal file on disk", () => {
    expect(rehearsalFilesOnDisk()).toContain("src/aws-rehearsal-profile.aws-rehearsal.test.ts");
    expect(rehearsalFilesOnDisk()).toContain("src/aws-stream-loop.aws-rehearsal.test.ts");
  });

  it("the default config never selects a rehearsal file", () => {
    const files = listed("vitest.config.ts");
    expect(files).toContain("src/testing/aws-rehearsal-selection.test.ts");
    expect(files.filter((file) => file.endsWith(REHEARSAL_SUFFIX))).toEqual([]);
  });

  it("the preproduction config never selects a rehearsal file", () => {
    const files = listed("vitest.preprod.config.ts");
    expect(files).toContain("src/aeat.preprod.test.ts");
    expect(files.filter((file) => file.endsWith(REHEARSAL_SUFFIX))).toEqual([]);
  });

  it("the rehearsal config selects exactly the rehearsal files on disk", () => {
    const files = listed("vitest.aws-rehearsal.config.ts");
    expect(files).toContain("src/aws-stream-loop.aws-rehearsal.test.ts");
    expect(files).toEqual(rehearsalFilesOnDisk().sort());
  });

  it("a rehearsal run without opt-in fails on the opt-in refusal", () => {
    const env = {
      ...childEnv(),
      AWS_SHARED_CREDENTIALS_FILE: join(PACKAGE_DIR, "no-such-dir", "credentials"),
    };
    const result = vitest(["run", "--config", "vitest.aws-rehearsal.config.ts"], env);
    expect(result.status).not.toBe(0);
    const output = stripVTControlCharacters(`${result.stdout}${result.stderr}`);
    expect(output).toContain("opt-in-missing");
    // The global setup refuses before any test file is collected, so no test result is reported.
    expect(output).not.toMatch(/Tests\s+\d+ (failed|passed)/);
  });
});
