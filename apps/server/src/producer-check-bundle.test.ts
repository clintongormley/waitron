import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const run = promisify(execFile);
let root: string | undefined;
let entry: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "producer-check-bundle-"));
  entry = join(root, "producer-check.js");
  await writeFile(join(root, "package.json"), '{"type":"module"}');
  await run(
    "pnpm",
    ["exec", "node", "../../scripts/bundle-node.mjs", `src/producer-check-entry.ts=${entry}`],
    { cwd: resolve("."), timeout: 180_000, maxBuffer: 2_000_000 },
  );
}, 190_000);
afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function runBundle(producer: Record<string, string>) {
  try {
    const { stdout, stderr } = await run(process.execPath, [entry], {
      cwd: root,
      env: { PATH: process.env.PATH ?? "", ...producer },
      timeout: 60_000,
    });
    return { code: 0, output: stdout + stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code, output: (failed.stdout ?? "") + (failed.stderr ?? "") };
  }
}

describe("the bundled producer check", () => {
  it("passes made-up settings the box would accept", async () => {
    const result = await runBundle({
      WAITRON_PRODUCER_NAME: "PRODUCER PERSON",
      WAITRON_PRODUCER_TAX_ID: "00000000T",
      WAITRON_PRODUCER_ADDRESS: "1 Example Street, 00000 Nowhere (Province), Spain",
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain("verifactu: the settings pass");
  });

  it("refuses an image that names no producer", async () => {
    const result = await runBundle({});
    expect(result.code).toBe(1);
    expect(result.output).toContain("sif.producer_unset");
  });
});
