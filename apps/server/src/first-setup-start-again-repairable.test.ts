import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { ALL_MODULES } from "@waitron/composition";
import { expectStartAgainDeleted } from "../test/start-again-deleted.js";
import { request } from "../test/first-fiscal.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";
import { createFirstSetupResolutionActions } from "./first-setup-resolution.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repairable(phase: "claimed" | "abandoned") {
  const root = await mkdtemp(join(tmpdir(), "start-again-repairable-"));
  roots.push(root);
  const folders = { stateDir: join(root, "state"), venueDir: join(root, "venue") };
  await mkdir(folders.venueDir, { recursive: true });
  const host = createFirstSetupModuleHost({
    ...folders,
    modules: ALL_MODULES,
    environment: {},
    database: () => suite.db,
  });
  await host.owner.claimFirstSetup({ environment: "production", request });
  if (phase === "abandoned") {
    const state = (await host.store.read())!;
    await host.store.update(state.frozen.attemptId, state.revision, { kind: "abandoned" });
  }
  await suite.db.archiveTo(join(folders.venueDir, "venue.db"));
  return { folders, host };
}

it.each(["claimed", "abandoned"] as const)(
  "a %s attempt without a venue claim is summarised and started again",
  async (phase) => {
    const { folders, host } = await repairable(phase);
    const inspected = await host.resolution.inspectFirstSetupResolution();
    expect(inspected.pair).toBe("valid");
    const ids = {
      inspectionId: inspected.inspectionId,
      revision: inspected.revision!,
      ownerGeneration: inspected.ownerGeneration!,
    };
    const actions = createFirstSetupResolutionActions({ ...folders, host });
    await expect(actions.startAgainSummary(ids)).resolves.toEqual({ reached: "claimed" });
    await actions.startAgainFirstSetup({
      ...ids,
      register: { kind: "no-current-master", confirmed: true },
    });
    await expectStartAgainDeleted(folders);
    for (const dir of [folders.venueDir, folders.stateDir])
      expect((await readdir(dir)).filter((name) => !/^venue\.(lock|holder)/.test(name))).toEqual(
        dir === folders.stateDir ? ["flows"] : [],
      );
    expect(await readdir(join(folders.stateDir, "flows"))).toEqual([]);
  },
);

it("a claimed attempt with public evidence is not an empty workspace", async () => {
  const { updateSetupFlowSection } = await import("@waitron/provisioning");
  const { folders, host } = await repairable("claimed");
  await updateSetupFlowSection(folders.stateDir, "publicEvidence", () => ({
    version: 1,
    modules: {},
    history: [],
  }));
  const inspected = await host.resolution.inspectFirstSetupResolution();
  const actions = createFirstSetupResolutionActions({ ...folders, host });
  await expect(
    actions.startAgainSummary({
      inspectionId: inspected.inspectionId,
      revision: inspected.revision!,
      ownerGeneration: inspected.ownerGeneration!,
    }),
  ).rejects.toMatchObject({ code: "setup.not_ready", params: { cause: "may-have-filed" } });
});
