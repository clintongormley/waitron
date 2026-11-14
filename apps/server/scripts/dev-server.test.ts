import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

describe("dev-server", () => {
  let workDir: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "waitron-dev-server-"));
  });

  afterAll(async () => {
    if (workDir !== undefined) await rm(workDir, { recursive: true, force: true });
  });

  // The missing-file refusal exits before copying migrations or starting the server.
  it("refuses a missing WAITRON_DEV_ENV_FILE and names that path", () => {
    const settingsFile = join(workDir, "missing.env");
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./dev-server.mjs", import.meta.url))],
      {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        encoding: "utf8",
        timeout: 30_000,
        env: { ...process.env, WAITRON_DEV_ENV_FILE: settingsFile },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(settingsFile);
    expect(result.stdout).toBe("");
  });
});
