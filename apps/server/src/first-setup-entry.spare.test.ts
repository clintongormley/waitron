import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolveFirstSetupEntry } from "./first-setup-entry.js";
import type { Statfs } from "./free-bytes.js";
import * as resolutionApi from "./setup-first-fiscal-api.js";

vi.mock("./setup-first-fiscal-api.js", { spy: true });

const MiB = 1024 * 1024;

let root: string;
let stateDir: string;
let anchor: { stateDir: string; venueDir: string };

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "wt-entry-spare-")));
  stateDir = join(root, "state");
  anchor = { stateDir, venueDir: join(stateDir, "venue") };
  await mkdir(anchor.venueDir, { recursive: true });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

const freeIs =
  (bytes: number): Statfs =>
  () =>
    Promise.resolve({ bavail: bytes, frsize: 1 });

const spareOption = (
  logDir = join(stateDir, "logs"),
  more: { venueDir?: string; statfs?: Statfs } = {},
) => ({
  stateDir,
  venueDir: anchor.venueDir,
  logDir,
  ...more,
});

/** The repair app's answer to "does the next start delete old logs", as its routes ask it. */
async function restartDeletesLogsIn(
  logDir?: string,
  more: { venueDir?: string; statfs?: Statfs } = { statfs: freeIs(MiB) },
) {
  const entry = await resolveFirstSetupEntry(
    anchor,
    {},
    undefined,
    vi.fn(),
    spareOption(logDir, more),
  );
  if (entry.kind !== "resolution") throw new Error(`expected the repair app, got ${entry.kind}`);
  const options = vi.mocked(resolutionApi.mountFirstSetupResolutionApi).mock.lastCall?.[3];
  const ask = () => options!.restartDeletesLogs!();
  return { ask };
}

it("the repair app's answer to whether the next start deletes old logs says it does below the floor, whatever the log folder", async () => {
  writeFileSync(join(stateDir, "first-setup.json"), "opaque retained attempt");
  const repair = await restartDeletesLogsIn();
  expect(await repair.ask()).toBe(true);
});

it("the repair app's answer to whether the next start deletes old logs cannot say when the disk reads as having room, where the next start deletes no log", async () => {
  writeFileSync(join(stateDir, "first-setup.json"), "opaque retained attempt");
  const repair = await restartDeletesLogsIn(join(root, "logs"), { statfs: freeIs(512 * MiB) });
  expect(await repair.ask()).toBeUndefined();
});

it("the repair app's answer to whether the next start deletes old logs cannot say when free space cannot be read", async () => {
  writeFileSync(join(stateDir, "first-setup.json"), "opaque retained attempt");
  const repair = await restartDeletesLogsIn(join(root, "logs"), {
    statfs: () => Promise.reject(new Error("EIO")),
  });
  expect(await repair.ask()).toBeUndefined();
});
