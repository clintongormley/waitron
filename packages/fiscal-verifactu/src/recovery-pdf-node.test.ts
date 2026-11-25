import { spawnSync } from "node:child_process";
import * as nodeFonts from "./recovery-pdf-node.js";
import { readFile } from "node:fs/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vitest";
import {
  inspectSetupRecoveryPack,
  setupPackDocument,
} from "../test/setup-recovery-pack-inspect.js";

const roots: string[] = [];
afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

it("reads the actual source font when the asset loader is unavailable", async () => {
  vi.doMock("./assets/register-noto-sans.ttf?inline", () => {
    throw new Error("No font asset loader");
  });
  try {
    expect(
      Buffer.from(await nodeFonts.loadRecoveryFont()).equals(
        await readFile(new URL("./assets/register-noto-sans.ttf", import.meta.url)),
      ),
      "regular font bytes",
    ).toBe(true);
  } finally {
    vi.doUnmock("./assets/register-noto-sans.ttf?inline");
  }
});

it("the setup recovery pack carries its fonts and attachment in a relocated real Node bundle", async () => {
  const root = await mkdtemp(join(tmpdir(), "waitron-recovery-pdf-bundle-"));
  roots.push(root);
  const output = join(root, "recovery.mjs");
  const build = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { bundle } from ${JSON.stringify(new URL("../../../scripts/bundle-node.mjs", import.meta.url).href)}; bundle(${JSON.stringify([{ entry: "test/setup-recovery-pack-runner.ts", outfile: output }])});`,
    ],
    { encoding: "utf8", timeout: 60_000 },
  );
  expect(build.status, build.stderr).toBe(0);
  const input = join(root, "input.json");
  await writeFile(input, JSON.stringify(setupPackDocument));
  for (const locale of ["en", "es"] as const) {
    const run = spawnSync(process.execPath, [output, input, locale, "Europe/Madrid"], {
      cwd: root,
      encoding: "buffer",
      timeout: 15_000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, NODE_PATH: "" },
    });
    expect(run.status, run.stderr?.toString()).toBe(0);
    await inspectSetupRecoveryPack(new Uint8Array(run.stdout), locale);
  }
});

it.each(["inline", "source"])("loads the pack's mono bytes from %s", async (source) => {
  const mono = await readFile(new URL("./assets/register-noto-sans-mono.ttf", import.meta.url));
  vi.doMock("./assets/register-noto-sans-mono.ttf?inline", () => {
    if (source === "source") throw new Error("No asset loader");
    return { default: `data:font/ttf;base64,${mono.toString("base64")}` };
  });
  try {
    const fonts = await nodeFonts.loadRecoveryPackFonts();
    expect(Buffer.from(fonts.mono).equals(mono), "mono font bytes").toBe(true);
    expect(
      Buffer.from(fonts.regular).equals(
        await readFile(new URL("./assets/register-noto-sans.ttf", import.meta.url)),
      ),
      "regular font bytes",
    ).toBe(true);
  } finally {
    vi.doUnmock("./assets/register-noto-sans-mono.ttf?inline");
  }
});
