import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { expect, it } from "vitest";

it("builds all shipped Node and browser applications in bundle-smoke", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const job = /^ {2}bundle-smoke:\n([\s\S]*?)(?=^ {2}[\w-]+:)/m.exec(workflow)?.[1];
  expect(job).toBeDefined();
  const commands = [...job.matchAll(/^ {6}- run: (pnpm .+ build)\s*$/gm)].map((m) => m[1]);
  const scratch = mkdtempSync(join(tmpdir(), "bundle-smoke-builds-"));
  const trace = join(scratch, "trace");
  writeFileSync(
    join(scratch, "pnpm"),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$BUNDLE_SMOKE_TRACE"\n',
    {
      mode: 0o755,
    },
  );
  try {
    for (const command of commands) {
      const result = spawnSync("sh", ["-c", command], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${scratch}:${process.env.PATH}`, BUNDLE_SMOKE_TRACE: trace },
        timeout: 5000,
      });
      expect(result.status, result.stderr).toBe(0);
    }
    expect(readFileSync(trace, "utf8").trim().split("\n")).toEqual([
      "--filter @waitron/credentials build",
      "--filter @waitron/server build",
      "--filter @waitron/print-agent build",
      "--filter @waitron/provisioning build",
      "--filter @waitron/dashboard build",
      "--filter @waitron/setup build",
      "--filter @waitron/till build",
    ]);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}, 60_000);
