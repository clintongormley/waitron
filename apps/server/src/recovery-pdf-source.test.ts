import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, expect, it } from "vitest";
import {
  inspectSetupRecoveryPack,
  setupPackDocument,
} from "@waitron/fiscal-verifactu/test/setup-recovery-pack-inspect.js";

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

it.each(["en", "es"] as const)(
  "the source command's tsx loader renders the real setup recovery pack in %s",
  async (locale) => {
    const root = await mkdtemp(join(tmpdir(), "waitron-recovery-source-"));
    roots.push(root);
    const input = join(root, "input.json");
    await writeFile(input, JSON.stringify(setupPackDocument));
    const run = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("../../packages/fiscal-verifactu/test/setup-recovery-pack-runner.ts"),
        input,
        locale,
        "Europe/Madrid",
      ],
      { encoding: "buffer", timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
    );
    expect(run.status, run.stderr?.toString()).toBe(0);
    await inspectSetupRecoveryPack(new Uint8Array(run.stdout), locale);
  },
);
