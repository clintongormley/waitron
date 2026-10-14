import { spawn } from "node:child_process";
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
// Below the package's 180 s hookTimeout, so a hung child fails as a timeout here, not as a hook kill.
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

interface ChildResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function vitest(args: string[], env: NodeJS.ProcessEnv = childEnv()): Promise<ChildResult> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [VITEST, ...args], {
      cwd: PACKAGE_DIR,
      env,
      timeout: CHILD_TIMEOUT_MS,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", fail);
    child.on("close", (status, signal) => {
      if (signal === null) done({ status, stdout, stderr });
      else fail(new Error(`vitest ${args.join(" ")} ended by ${signal}`));
    });
  });
}

const listChild = (config: string) => vitest(["list", "--filesOnly", "--json", "--config", config]);

function listed(result: ChildResult): string[] {
  expect(result.status, result.stderr).toBe(0);
  return (JSON.parse(result.stdout) as { file: string }[])
    .map((entry) => relative(PACKAGE_DIR, entry.file))
    .sort();
}

describe("AWS rehearsal test selection", () => {
  // Each child is a cold Vitest start, so they start together rather than one after another.
  let children: Record<"defaults" | "preprod" | "rehearsal" | "run", ChildResult>;

  beforeAll(async () => {
    const [defaults, preprod, rehearsal, run] = await Promise.all([
      listChild("vitest.config.ts"),
      listChild("vitest.preprod.config.ts"),
      listChild("vitest.aws-rehearsal.config.ts"),
      vitest(["run", "--config", "vitest.aws-rehearsal.config.ts"], {
        ...childEnv(),
        AWS_SHARED_CREDENTIALS_FILE: join(PACKAGE_DIR, "no-such-dir", "credentials"),
      }),
    ]);
    children = { defaults, preprod, rehearsal, run };
  });

  it("finds at least one rehearsal file on disk", () => {
    expect(rehearsalFilesOnDisk()).toContain("src/aws-rehearsal-profile.aws-rehearsal.test.ts");
    expect(rehearsalFilesOnDisk()).toContain("src/aws-stream-loop.aws-rehearsal.test.ts");
  });

  it("the default config never selects a rehearsal file", () => {
    const files = listed(children.defaults);
    expect(files).toContain("src/testing/aws-rehearsal-selection.test.ts");
    expect(files.filter((file) => file.endsWith(REHEARSAL_SUFFIX))).toEqual([]);
  });

  it("the preproduction config never selects a rehearsal file", () => {
    const files = listed(children.preprod);
    expect(files).toContain("src/aeat.preprod.test.ts");
    expect(files.filter((file) => file.endsWith(REHEARSAL_SUFFIX))).toEqual([]);
  });

  it("the rehearsal config selects exactly the rehearsal files on disk", () => {
    const files = listed(children.rehearsal);
    expect(files).toContain("src/aws-stream-loop.aws-rehearsal.test.ts");
    expect(files).toEqual(rehearsalFilesOnDisk().sort());
  });

  it("a rehearsal run without opt-in fails on the opt-in refusal", () => {
    const result = children.run;
    expect(result.status).not.toBe(0);
    const output = stripVTControlCharacters(`${result.stdout}${result.stderr}`);
    expect(output).toContain("opt-in-missing");
    // The global setup refuses before any test file is collected, so no test result is reported.
    expect(output).not.toMatch(/Tests\s+\d+ (failed|passed)/);
  });
});
