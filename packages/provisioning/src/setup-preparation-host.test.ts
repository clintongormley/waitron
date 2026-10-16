import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { ModuleOperationHost, OperationBinding } from "@waitron/module";
import { AppError } from "@waitron/shared";
import { createFirstSetupCoordinator, type FirstSetupHold } from "./first-setup-state.js";
import { createSetupPreparationHost } from "./setup-preparation-host.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const binding: OperationBinding = {
  module: "test-regime",
  action: "setup",
  eventId: "event-1",
  sourceId: "first-setup:attempt-1",
  targetNodeId: "node-1",
};
const facts = {
  context: {
    attemptId: "attempt-1",
    binding,
    administratorId: "admin-1",
    country: "ES",
    taxId: "50000000R",
    environment: "preproduction" as const,
    recipientVenueId: binding.sourceId,
    bases: [{ code: "A", purpose: "standard" }],
  },
  contextKey: "owner-generation-1",
  localHistory: { reference: "venue", complete: true, records: [] },
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "setup-preparation-host-"));
  roots.push(root);
  let allowed = true;
  let replacementAllowed = true;
  let reads = 0;
  let readFacts: NonNullable<ModuleOperationHost["readSetupFacts"]> = async () => {
    reads++;
    return structuredClone(facts);
  };
  const coordinator = createFirstSetupCoordinator();
  const options = {
    stateDir: join(root, "state"),
    venueDir: join(root, "venue"),
    coordinator,
    authorize: async (value: OperationBinding) => {
      if (!allowed || value.eventId !== binding.eventId)
        throw new AppError("setup.owner_required", {});
    },
    authorizeReplacement: async () => {
      if (!replacementAllowed) throw new AppError("setup.owner_required", {});
    },
    withVenueExclusion: async <T>(run: () => Promise<T>) => run(),
    readSetupFacts: (value: OperationBinding) => readFacts(value),
  };
  return {
    create: (hold?: FirstSetupHold) =>
      createSetupPreparationHost({
        ...options,
        ...(hold === undefined ? {} : { currentHold: () => hold }),
      }),
    coordinator,
    path: join(options.stateDir, "module-preparation-state.json"),
    deny: () => {
      allowed = false;
    },
    denyReplacement: () => {
      replacementAllowed = false;
    },
    reads: () => reads,
    setReader: (reader: typeof readFacts) => {
      readFacts = reader;
    },
  };
}

it("reopens the same durable module preparation from a new host", async () => {
  const f = await fixture();
  await f.create().withPreparationState(binding, async (state) => {
    expect(state.value).toBeNull();
    await state.replace({ selectedIdentity: "06RB" });
  });
  await f.create().withPreparationState(binding, async (state) => {
    expect(state.value).toEqual({ selectedIdentity: "06RB" });
    expect(state.history).toEqual([{ selectedIdentity: "06RB" }]);
  });
  expect(JSON.parse(await readFile(f.path, "utf8"))).toEqual({
    version: 1,
    revisions: [{ binding, value: { selectedIdentity: "06RB" } }],
  });
});

it("refuses a facts read outside the preparation scope before consulting the host", async () => {
  const f = await fixture();
  await expect(f.create().readSetupFacts(binding)).rejects.toMatchObject({
    code: "setup.attempt_conflict",
  });
  expect(f.reads()).toBe(0);
});

it("cannot use one binding's scope to read another binding's facts", async () => {
  const f = await fixture();
  const host = f.create();
  await expect(
    host.withPreparationState(binding, () =>
      host.readSetupFacts({ ...binding, targetNodeId: "another-node" }),
    ),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(f.reads()).toBe(0);
});

it("returns the host's facts only while the matching scope is held", async () => {
  const f = await fixture();
  const host = f.create();
  const value = await host.withPreparationState(binding, () => host.readSetupFacts(binding));
  expect(value).toEqual(facts);
  expect(f.reads()).toBe(1);
});

it("refuses an in-flight facts read whose preparation callback has returned", async () => {
  const f = await fixture();
  const host = f.create();
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reading = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.setReader(async () => {
    entered();
    await gate;
    return structuredClone(facts);
  });
  let pending!: ReturnType<typeof host.readSetupFacts>;
  await host.withPreparationState(binding, async () => {
    pending = host.readSetupFacts(binding);
    await reading;
  });
  const refusal = expect(pending).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  release();
  await refusal;
});

it("preserves the journal when the host refuses authorization", async () => {
  const f = await fixture();
  const host = f.create();
  await host.withPreparationState(binding, (state) => state.replace({ selectedIdentity: "06RB" }));
  const before = await readFile(f.path, "utf8");
  f.deny();
  await expect(
    host.withPreparationState(binding, (state) => state.replace({ selectedIdentity: "06RC" })),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  expect(await readFile(f.path, "utf8")).toBe(before);
});

it("uses a caller's existing coordinator hold and expires it after the caller exits", async () => {
  const f = await fixture();
  const host = await f.coordinator.run(async (hold) => {
    const value = f.create(hold);
    await value.withPreparationState(binding, async (state) => {
      await state.replace({ selectedIdentity: "06RB" });
      expect(await value.readSetupFacts(binding)).toEqual(facts);
    });
    return value;
  });
  await expect(
    host.withPreparationState(binding, async (state) => state.value),
  ).rejects.toMatchObject({ code: "setup.attempt_conflict" });
  expect(JSON.parse(await readFile(f.path, "utf8")).revisions).toHaveLength(1);
});

it("does not persist a candidate when the replacement authority refuses it", async () => {
  const f = await fixture();
  const host = f.create();
  await host.withPreparationState(binding, (state) => state.replace({ selectedIdentity: "06RB" }));
  const before = await readFile(f.path, "utf8");
  f.denyReplacement();
  await expect(
    host.withPreparationState(binding, (state) => state.replace({ selectedIdentity: "06RC" })),
  ).rejects.toMatchObject({ code: "setup.owner_required" });
  expect(await readFile(f.path, "utf8")).toBe(before);
});
