import { basename, join } from "node:path";
import * as filesystem from "node:fs/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { readFirstSetupRetirements } from "@waitron/provisioning";
import { hourFirstFiscalFixture } from "../test/hour-first-fiscal.js";
import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";

vi.mock("node:fs/promises", { spy: true });
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
vi.mock("@waitron/fiscal-verifactu/src/hour-clock-internet.js", () => ({
  observeInternetHourClock: async () => ({
    source: "internet",
    result: "usable",
    instantMs: Date.now(),
    uncertaintyMs: 500,
    wallStartedMs: Date.now(),
    wallFinishedMs: Date.now(),
    monotonicStartedMs: performance.now(),
    monotonicFinishedMs: performance.now(),
  }),
}));
vi.mock("@waitron/fiscal-verifactu/src/hour-release.js", () => ({
  readHourRelease: () => ({ instantMs: Date.parse("2026-10-15T00:00:00Z") }),
}));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  vi.setSystemTime("2026-10-16T11:40:00Z");
});
const fixtures: Awaited<ReturnType<typeof hourFirstFiscalFixture>>[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(fixtures.splice(0).map((f) => f.dispose()));
});
async function fixture(workspace?: { root: string; stateDir: string; venueDir: string }) {
  if (workspace !== undefined) vi.setSystemTime(new Date(Date.now() + 3_600_000));
  const f = await hourFirstFiscalFixture({
    database: () => suite.db,
    ...(workspace === undefined ? {} : { workspace }),
  });
  fixtures.push(f);
  await suite.db.archiveTo(join(f.venueDir, "venue.db"));
  const actions = createFirstSetupResolutionActions({ ...f, host: f.host });
  const start = async () => {
    const inspected = await f.host.resolution.inspectFirstSetupResolution();
    return actions.startAgainFirstSetup({
      inspectionId: inspected.inspectionId,
      revision: inspected.revision!,
      ownerGeneration: inspected.ownerGeneration!,
      register: {
        kind: "current-master",
        status: "Consumed",
        custodian: "Elena",
        reference: f.staged.ref.bindingDigest,
        consultedAt: "2026-10-16T12:20:00.000Z",
      },
    });
  };
  return { ...f, start };
}
async function archiveOpens<T>(run: () => Promise<T>) {
  const open = vi.mocked(filesystem.open);
  const before = open.mock.calls.length;
  const result = await run();
  const perFile = new Map<string, number>();
  for (const [path] of open.mock.calls.slice(before)) {
    const name = String(path);
    if (!name.includes("first-setup-resolutions")) continue;
    if (basename(name) !== "manifest.json" && !/^original-\d+-\d+\.json$/.test(basename(name)))
      continue;
    perFile.set(name, (perFile.get(name) ?? 0) + 1);
  }
  const total = [...perFile.values()].reduce((sum, count) => sum + count, 0);
  return { result, total, most: Math.max(0, ...perFile.values()) };
}
it("each retired setup archive file is opened at most once per read, at one, two and three earlier retirements", async () => {
  let f = await fixture();
  const attempts: string[] = [];
  const totals: { read: number; prepare: number; readMost: number; prepareMost: number }[] = [];
  for (let retirements = 0; ; retirements++) {
    const read = await archiveOpens(() => readFirstSetupRetirements(f));
    expect(read.result.map((entry) => entry.state.frozen.attemptId)).toEqual(
      [...attempts].reverse(),
    );
    const state = (await f.store.read())!;
    const prepare = await archiveOpens(() => f.host.assertFreshAssignment(state, f.module));
    expect(prepare.result).toBeUndefined();
    totals.push({
      read: read.total,
      prepare: prepare.total,
      readMost: read.most,
      prepareMost: prepare.most,
    });
    if (retirements === 3) break;
    attempts.push(f.ownerAttempt.attemptId);
    const binding = await f.start();
    f = await fixture({ root: f.root, venueDir: binding.venueDir, stateDir: binding.stateDir });
  }
  for (const counted of totals.slice(1)) {
    expect(counted.read).toBeGreaterThan(0);
    expect(counted.prepare).toBeGreaterThan(0);
    expect(counted.readMost).toBeLessThanOrEqual(1);
    expect(counted.prepareMost).toBeLessThanOrEqual(1);
  }
  const [, one, , three] = totals;
  expect(three!.read).toBeLessThanOrEqual(3 * one!.read * 1.1);
  expect(three!.prepare).toBeLessThanOrEqual(3 * one!.prepare * 1.1);
});
