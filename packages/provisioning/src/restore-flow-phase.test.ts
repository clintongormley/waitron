import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { readRestoreFlowPhase } from "./restore-flow-phase.js";

let stateDir: string;
beforeEach(async () => {
  stateDir = await mkdtemp(join(tmpdir(), "restore-flow-phase-"));
});
afterEach(async () => {
  await rm(stateDir, { recursive: true, force: true });
});

async function record(body: string) {
  const folder = join(stateDir, "flows", "restore");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "record.json"), body);
}

it("finds no restore when its folder is absent", async () => {
  expect(await readRestoreFlowPhase(stateDir)).toBeNull();
});

it.each(["staged", "placing", "first-start"] as const)("reads the %s phase", async (phase) => {
  await record(JSON.stringify({ version: 1, phase }));
  expect(await readRestoreFlowPhase(stateDir)).toBe(phase);
});

it.each(["{", "null", '{"version":2,"phase":"staged"}', '{"version":1,"phase":"unknown"}'])(
  "reports an unreadable restore record: %s",
  async (body) => {
    await record(body);
    expect(await readRestoreFlowPhase(stateDir)).toBe("unreadable");
  },
);
