import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";

it.each([
  ["capture", /Run this fixture with Node network permission denied/],
  ["restore", /ENOENT.*input\.backup\.enc/],
])("%s enforces its own fixture boundary", (command, error) => {
  const root = mkdtempSync(join(tmpdir(), "cloud-integration-backup-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/cloud-backup-fixture.ts"],
    {
      env: { ...process.env, CLOUD_TEST_ROOT: root },
      input: JSON.stringify({ command, recoveryKey: "A".repeat(43) }),
      encoding: "utf8",
      timeout: 20_000,
    },
  );
  expect(child.error).toBeUndefined();
  expect(child.status).toBe(1);
  expect(child.stderr).toMatch(error);
});
