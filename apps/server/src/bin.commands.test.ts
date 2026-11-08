import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_PRODUCER } from "./testing/test-producer.js";

const CHILD_LIMIT_MS = 60_000;

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "bin-commands-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** Runs src/bin.ts in its own process, in an empty folder and with only the settings given. */
function runBin(args: readonly string[], settings: Record<string, string>) {
  return new Promise<{ code: number | null; signal: string | null; output: string }>((resolve) => {
    execFile(
      process.execPath,
      [
        "--import",
        pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
        fileURLToPath(new URL("./bin.ts", import.meta.url)),
        ...args,
      ],
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
          output: stdout + stderr,
        });
      },
    );
  });
}

describe("the server program's commands", { timeout: CHILD_LIMIT_MS + 10_000 }, () => {
  it("check-producer exits 0 on valid settings and creates nothing", async () => {
    const result = await runBin(["check-producer"], TEST_PRODUCER);
    expect(result, result.output).toMatchObject({ code: 0, signal: null });
    expect(result.output).toContain("verifactu: the settings pass");
    expect(await readdir(root)).toEqual([]);
  });

  it("check-producer exits 1 on a wrong check letter, naming the setting and no value", async () => {
    const result = await runBin(["check-producer"], {
      ...TEST_PRODUCER,
      WAITRON_PRODUCER_TAX_ID: "00000000A",
    });
    expect(result, result.output).toMatchObject({ code: 1, signal: null });
    expect(result.output).toContain(
      "verifactu: sif.producer_invalid (setting WAITRON_PRODUCER_TAX_ID, reason check_failed)",
    );
    expect(result.output).not.toContain("00000000A");
    expect(await readdir(root)).toEqual([]);
  });

  it("an unknown command exits 1 rather than starting a server", async () => {
    const result = await runBin(["check-producers"], TEST_PRODUCER);
    expect(result, result.output).toMatchObject({ code: 1, signal: null });
    expect(result.output).toContain("unknown command: check-producers");
    expect(await readdir(root)).toEqual([]);
  });
});
