import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { fakeModule } from "@waitron/module/src/testing/fake-module.js";
import type { InitialSetupContribution } from "@waitron/module";
import { request, PASSWORD } from "../test/first-fiscal.js";
import { createFirstSetupModuleHost } from "./module-operation-host.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const binding = {
  module: "test-regime",
  action: "setup",
  eventId: "event-1",
  sourceId: "source-1",
  targetNodeId: "node-1",
};

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "setup-host-routing-"));
  roots.push(root);
  return createFirstSetupModuleHost({
    stateDir: join(root, "state"),
    venueDir: join(root, "venue"),
    environment: {},
    modules: [],
  });
}

it.each(["restore", "promote", "reserve", "establish"])(
  "leaves ordinary %s evidence to its operation host when no first setup exists",
  async (action) => {
    const host = await fixture();
    await expect(host.evidence.read({ ...binding, action })).resolves.toBeUndefined();
  },
);

it("still refuses setup evidence without an owned attempt", async () => {
  const host = await fixture();
  await expect(host.evidence.read(binding)).rejects.toMatchObject({ code: "setup.owner_required" });
});

it.each([false, true])(
  "checks assignment reuse after confirming owned setup evidence (reused: %s)",
  async (reused) => {
    const root = await mkdtemp(join(tmpdir(), "setup-evidence-assignment-"));
    roots.push(root);
    const seat: InitialSetupContribution = {
      candidates: (_context, proposal) => proposal,
      request: (_context, proposal) => proposal,
      inspect: (_context, input) => ({ input, summary: null }),
      enrol: () => ({ matched: true }),
      confirmation: () => ({ accepted: true }),
      committed: async () => null,
      assignmentKeys: (context) => (context.request === null ? [] : [String(context.request)]),
    };
    const host = createFirstSetupModuleHost({
      stateDir: join(root, "state"),
      venueDir: join(root, "venue"),
      environment: {},
      modules: [fakeModule("test-regime", { provisioning: { initialSetup: seat } })],
    });
    const claim = () =>
      host.owner.claimFirstSetup(
        { environment: "preproduction", request },
        randomBytes(32).toString("base64url"),
      );
    await claim();
    let state = (await host.store.read())!;
    state = await host.store.update(state.frozen.attemptId, state.revision, {
      kind: "candidates",
      module: "test-regime",
      request: "spent-assignment",
    });
    await host.store.update(state.frozen.attemptId, state.revision, { kind: "abandoned" });
    const claimed = await claim();
    state = (await host.store.read())!;
    for (const change of [
      {
        kind: "candidates",
        module: "test-regime",
        request: reused ? "spent-assignment" : "fresh-assignment",
      },
      { kind: "input", module: "test-regime", input: { selected: true } },
      { kind: "consumption-intent" },
    ] as const)
      state = await host.store.update(state.frozen.attemptId, state.revision, change);
    const owner = { ...claimed.state, revision: state.revision, capability: claimed.capability };
    await host.evidence.enrol(owner, "test-regime", { key: "synthetic" }, "matched");
    await host.evidence.confirm(
      owner,
      "test-regime",
      { kept: true },
      await host.owner.reconfirm(owner, PASSWORD, "activation"),
    );
    const evidence = host.evidence.read({
      module: "test-regime",
      action: "setup",
      eventId: state.frozen.modules[0]!.eventId,
      sourceId: state.frozen.sourceId,
      targetNodeId: state.frozen.nodeId,
    });
    if (reused) await expect(evidence).rejects.toMatchObject({ code: "setup.attempt_conflict" });
    else
      await expect(evidence).resolves.toEqual({
        trust: { matched: true },
        current: { accepted: true },
      });
  },
);
