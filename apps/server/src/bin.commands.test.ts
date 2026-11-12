import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useBuiltServer } from "./testing/built-server.js";
import { TEST_RELEASE } from "./testing/declaration-folder.js";
import { TEST_PRODUCER } from "./testing/test-producer.js";

const CHILD_LIMIT_MS = 60_000;
const USAGE = "usage: waitron-server [check-producer | check-release <version>]";

const builtServer = useBuiltServer();

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "bin-commands-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Runs the built server program in its own process, in an empty folder and with only the settings given. */
function runBin(
  args: readonly string[],
  settings: Record<string, string>,
  program: string = builtServer(),
) {
  return new Promise<{
    code: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
  }>((resolve) => {
    execFile(
      process.execPath,
      [program, ...args],
      {
        cwd: root,
        env: {
          PATH: process.env.PATH ?? "",
          WAITRON_STATE_DIR: join(root, "state"),
          WAITRON_VENUE_DIR: join(root, "venue"),
          ...settings,
        },
        timeout: CHILD_LIMIT_MS,
      },
      (error, stdout, stderr) => {
        const failure = error as { code?: unknown; signal?: string | null } | null;
        resolve({
          code: failure === null ? 0 : typeof failure.code === "number" ? failure.code : null,
          signal: failure?.signal ?? null,
          stdout,
          stderr,
        });
      },
    );
  });
}

describe("the built server program's commands", { timeout: CHILD_LIMIT_MS + 10_000 }, () => {
  it("check-producer exits 0 on valid settings, printing no value and creating nothing", async () => {
    const result = await runBin(["check-producer"], TEST_PRODUCER);
    expect(result, result.stderr).toMatchObject({ code: 0, signal: null });
    expect(result.stdout).toContain("verifactu: the settings pass");
    for (const value of Object.values(TEST_PRODUCER))
      expect(result.stdout + result.stderr).not.toContain(value);
    expect(await readdir(root)).toEqual([]);
  });

  it("check-producer exits 1 on a wrong check letter, naming the setting and no value", async () => {
    const result = await runBin(["check-producer"], {
      ...TEST_PRODUCER,
      WAITRON_PRODUCER_TAX_ID: "00000000A",
    });
    const printed = result.stdout + result.stderr;
    expect(result, printed).toMatchObject({ code: 1, signal: null });
    expect(result.stderr).toContain(
      "verifactu: sif.producer_invalid (setting WAITRON_PRODUCER_TAX_ID, reason check_failed)",
    );
    expect(printed).not.toContain("00000000A");
    expect(printed).not.toContain(TEST_PRODUCER.WAITRON_PRODUCER_NAME);
    expect(printed).not.toContain(TEST_PRODUCER.WAITRON_PRODUCER_ADDRESS);
    expect(await readdir(root)).toEqual([]);
  });

  it("check-producer exits 1 on an address of spaces alone", async () => {
    const result = await runBin(["check-producer"], {
      ...TEST_PRODUCER,
      WAITRON_PRODUCER_ADDRESS: "   ",
    });
    const printed = result.stdout + result.stderr;
    expect(result, printed).toMatchObject({ code: 1, signal: null });
    expect(result.stderr).toContain(
      "verifactu: software_producer.invalid (setting WAITRON_PRODUCER_ADDRESS, reason missing)",
    );
    expect(printed).not.toContain(TEST_PRODUCER.WAITRON_PRODUCER_NAME);
    expect(printed).not.toContain(TEST_PRODUCER.WAITRON_PRODUCER_TAX_ID);
    expect(await readdir(root)).toEqual([]);
  });

  it("check-producer exits 1 when no producer is set at all", async () => {
    const result = await runBin(["check-producer"], {});
    expect(result, result.stdout + result.stderr).toMatchObject({ code: 1, signal: null });
    expect(result.stderr).toContain("verifactu: sif.producer_unset");
    expect(await readdir(root)).toEqual([]);
  });

  it.each([
    ["an unknown word", ["check-producers"], "check-producers"],
    ["a word after the command", ["check-producer", "extra"], "extra"],
  ])(
    "%s prints the usage and exits 2 rather than starting a server",
    async (_case, args, typed) => {
      const result = await runBin(args, TEST_PRODUCER);
      const printed = result.stdout + result.stderr;
      expect(result, printed).toMatchObject({ code: 2, signal: null });
      expect(result.stderr.trim()).toBe(USAGE);
      expect(result.stdout).toBe("");
      expect(printed).not.toContain(typed);
      expect(await readdir(root)).toEqual([]);
    },
  );
});

describe("check-release on the test bundle", { timeout: CHILD_LIMIT_MS + 10_000 }, () => {
  it("exits 1, the bundle carrying no stamp", async () => {
    const result = await runBin(["check-release", "1.2.3"], TEST_PRODUCER);
    expect(result, result.stdout + result.stderr).toMatchObject({ code: 1, signal: null });
    expect(result.stderr).toBe("bundle version none\ndeclaration folder none\n");
    expect(await readdir(root)).toEqual([]);
  });
});

describe("check-release on a release bundle", { timeout: CHILD_LIMIT_MS + 10_000 }, () => {
  const releaseServer = useBuiltServer(undefined, {
    releaseVersion: TEST_RELEASE.version,
    declaration: TEST_RELEASE,
  });

  it("exits 0 for the version the bundle and its declaration folder carry", async () => {
    const result = await runBin(["check-release", TEST_RELEASE.version], {}, releaseServer());
    expect(result, result.stdout + result.stderr).toMatchObject({ code: 0, signal: null });
    expect(result.stdout).toContain("release: the bundle and the declaration folder match");
    expect(result.stderr).toBe("");
  });

  it("exits 1 for another version, naming the bundle's and the folder's", async () => {
    const result = await runBin(["check-release", "1.2.4"], {}, releaseServer());
    expect(result, result.stdout + result.stderr).toMatchObject({ code: 1, signal: null });
    expect(result.stderr).toContain(`bundle version ${TEST_RELEASE.version}`);
    expect(result.stderr).toContain(`declaration folder version ${TEST_RELEASE.version}`);
  });
});
