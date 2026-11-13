import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { TEST_MIGRATIONS } from "@waitron/fiscal-verifactu/test/migrations.js";
import { clock, external } from "../test/hour-recovery-host.js";
import { heldSetup } from "../test/held-setup-database.js";
import { hourFirstFiscalFixture } from "../test/hour-first-fiscal.js";
import { request } from "../test/first-fiscal.js";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ALL_MODULES } from "@waitron/composition";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";
import { emptyScratch } from "./scratch.js";

const early = useVenueDb({ migrations: TEST_MIGRATIONS });
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
it.each([
  "claimed",
  "consumption-intent",
  "activation-started",
  "committed",
  "publication",
] as const)("Start again after %s leaves only the box's own files", async (status) => {
  let host: ReturnType<typeof createFirstSetupModuleHost>;
  let folders: { stateDir: string; venueDir: string };
  if (status === "committed" || status === "publication") {
    const held = await heldSetup();
    host = held.host;
    folders = held.roots;
    if (status === "publication") {
      const state = (await host.store.read())!;
      await host.store.update(state.frozen.attemptId, state.revision, { kind: "publication" });
    }
  } else {
    const root = await mkdtemp(join(tmpdir(), "setup-stage-leftovers-"));
    roots.push(root);
    folders = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
    await mkdir(folders.venueDir);
    if (status === "claimed") {
      host = createFirstSetupModuleHost({
        ...folders,
        modules: ALL_MODULES,
        environment: {},
        database: () => early.db,
        testClock: clock,
      });
      await host.owner.claimFirstSetup({ environment: "production", request });
    } else {
      external.internet.mockImplementation(async () => ({
        source: "internet",
        result: "usable",
        instantMs: Date.now(),
        uncertaintyMs: 500,
        wallStartedMs: Date.now(),
        wallFinishedMs: Date.now(),
        monotonicStartedMs: performance.now(),
        monotonicFinishedMs: performance.now(),
      }));
      const prepared = await hourFirstFiscalFixture({
        database: () => early.db,
        clock,
        workspace: { root, ...folders },
      });
      host = prepared.host;
      if (status === "activation-started") {
        const state = (await host.store.read())!;
        await host.store.update(state.frozen.attemptId, state.revision, {
          kind: "activation-started",
        });
      }
    }
  }
  expect((await host.store.read())?.status).toBe(status);
  const inspected = await host.resolution.inspectFirstSetupResolution();
  const ids = {
    inspectionId: inspected.inspectionId,
    revision: inspected.revision!,
    ownerGeneration: inspected.ownerGeneration!,
  };
  const actions = createFirstSetupResolutionActions({ ...folders, host });
  const shown = await actions.startAgainSummary(ids);
  await actions.startAgainFirstSetup({
    ...ids,
    ...(inspected.database === "missing"
      ? { confirmMissingDatabase: { nothingFiledOrSold: true, shown } }
      : {}),
  });
  await emptyScratch(folders.stateDir, () => {});
  const allowed = [
    "backup.env",
    "flows",
    "module-records",
    "records",
    "recovery.json",
    "recovery.lock",
    "scratch",
    "secrets.env",
    "spare-space",
    "spare-space.released",
    "tls",
    "venue",
  ];
  expect((await readdir(folders.stateDir)).filter((name) => !allowed.includes(name))).toEqual([]);
  expect(await readdir(join(folders.stateDir, "flows"))).toEqual([]);
  expect(
    await readdir(join(folders.stateDir, "scratch")).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    }),
  ).toEqual([]);
  expect(
    (await readdir(folders.venueDir)).filter(
      (name) =>
        ![
          "venue.lock",
          "venue.lock-journal",
          "venue.holder.json",
          "migrations.lock",
          "recovery.lock",
        ].includes(name),
    ),
  ).toEqual([]);
});
