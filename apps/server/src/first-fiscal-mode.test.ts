import { expect, it } from "vitest";
import { firstFiscalFixture } from "../test/first-fiscal.js";
import { reconcileFirstSetupBeforeMode } from "./first-fiscal-mode.js";
import { type ServerConfig } from "./config.js";
it.each(["activation-started", "committed", "publication"] as const)(
  "returns %s to owner setup before any trading duty",
  async (status) => {
    const f = await firstFiscalFixture();
    try {
      let state = await f.store.update(f.context.attemptId, f.ownerAttempt.revision, {
        kind: "activation-started",
      });
      if (status !== "activation-started")
        state = await f.store.update(f.context.attemptId, state.revision, {
          kind: "committed",
          result: { venue: { nodeId: f.context.binding.targetNodeId, locationId: "location" } },
        });
      if (status === "publication")
        await f.store.update(f.context.attemptId, state.revision, { kind: "publication" });
      const config = {
        till: { nodeId: f.context.binding.targetNodeId, locationId: "location" },
      } as ServerConfig;
      await reconcileFirstSetupBeforeMode(config, f.store);
      expect(config.till).toBeUndefined();
      expect((await f.store.read())?.status).toBe(status);
    } finally {
      await f.dispose();
    }
  },
);
it("durably completed ordinary trading needs no fresh outside consultation", async () => {
  const f = await firstFiscalFixture();
  try {
    let state = (await f.store.read())!;
    for (const change of [
      { kind: "activation-started" },
      {
        kind: "committed",
        result: { venue: { nodeId: f.context.binding.targetNodeId, locationId: "location" } },
      },
      { kind: "publication" },
      { kind: "complete" },
    ] as const)
      state = await f.store.update(f.context.attemptId, state.revision, change);
    const till = { nodeId: f.context.binding.targetNodeId, locationId: "location" };
    const config = { till } as ServerConfig;
    await reconcileFirstSetupBeforeMode(config, f.store);
    expect(config.till).toEqual(till);
    await expect(
      reconcileFirstSetupBeforeMode(
        { till: { ...till, nodeId: "other" } } as ServerConfig,
        f.store,
      ),
    ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  } finally {
    await f.dispose();
  }
});
