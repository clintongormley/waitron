import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { lockVenueDatabase } from "@waitron/db";
import { createFirstSetupCoordinator } from "./first-setup-state.js";
import {
  createModulePreparationState,
  readModulePreparationHistory,
} from "./module-preparation-state.js";

let root: string;
let stateDir: string;
let venueDir: string;
const binding = {
  module: "one",
  action: "setup",
  eventId: "event",
  sourceId: "attempt",
  targetNodeId: "node",
};
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "module-preparation-backup-")));
  stateDir = join(root, "state");
  venueDir = join(root, "venue");
  await mkdir(stateDir);
  await mkdir(venueDir);
});
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
it("keeps every committed revision of the requested module after a fresh reader opens", async () => {
  const store = createModulePreparationState({
    stateDir,
    venueDir,
    coordinator: createFirstSetupCoordinator(),
    authorize: async () => {},
    withVenueExclusion: async (run) => {
      const lock = await lockVenueDatabase(venueDir);
      try {
        return await run();
      } finally {
        lock.release();
      }
    },
  });
  await store.withState(binding, (state) => state.replace({ spent: "higher" }));
  await store.withState({ ...binding, eventId: "another" }, (state) =>
    state.replace({ spent: "lower" }),
  );
  await store.withState({ ...binding, module: "two" }, (state) =>
    state.replace({ private: "other-module" }),
  );
  expect(await readModulePreparationHistory({ stateDir, venueDir }, "one")).toEqual([
    { spent: "higher" },
    { spent: "lower" },
  ]);
  expect(await readModulePreparationHistory({ stateDir, venueDir }, "two")).toEqual([
    { private: "other-module" },
  ]);
});
it("reports no revisions when this host has no journal", async () => {
  expect(await readModulePreparationHistory({ stateDir, venueDir }, "one")).toEqual([]);
});
it.each([
  "{",
  JSON.stringify({ version: 2, revisions: [] }),
  JSON.stringify({ version: 1, revisions: [{ binding: { ...binding, sourceId: "" }, value: {} }] }),
])("refuses a damaged host journal instead of reporting empty history %#", async (value) => {
  await writeFile(join(stateDir, "module-preparation-state.json"), value);
  await expect(readModulePreparationHistory({ stateDir, venueDir }, "one")).rejects.toMatchObject({
    code: "setup.attempt_invalid",
  });
});
