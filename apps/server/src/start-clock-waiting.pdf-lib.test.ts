import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it, vi } from "vitest";

const pdfLib = vi.hoisted(() => ({ loads: 0 }));
vi.mock("pdf-lib", async (load) => {
  pdfLib.loads += 1;
  return load();
});

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

it("the box's start loads no PDF reader until the restore clock page is sent a pack", async () => {
  await import("./node-entry.js");
  const { createStartClockWaiting } = await import("./start-clock-waiting.js");
  expect(pdfLib.loads).toBe(0);

  const stateDir = await mkdtemp(join(tmpdir(), "waitron-start-clock-pdf-lib-"));
  dirs.push(stateDir);
  const waiting = createStartClockWaiting({
    stateDir,
    setBoxClock: async () => ({ status: "set" }),
  });
  const res = await waiting.app.request("/restore-clock/pack", {
    method: "POST",
    headers: { "content-type": "application/pdf" },
    body: "not a PDF",
  });
  expect(await res.json()).toEqual({ result: "not_a_pack" });
  expect(pdfLib.loads).toBe(1);
});
