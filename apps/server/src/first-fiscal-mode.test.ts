import { seedVenueSettings } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { nodes, locations } from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { expect, it } from "vitest";
import { firstFiscalFixture } from "../test/first-fiscal.js";
import { reconcileFirstSetupBeforeMode } from "./first-fiscal-mode.js";
import { loadConfig } from "./config.js";
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const LOCATION = "55555555-5555-4555-8555-555555555555";
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
          result: { venue: { nodeId: f.context.binding.targetNodeId } },
        });
      if (status === "publication")
        await f.store.update(f.context.attemptId, state.revision, { kind: "publication" });
      const config = loadConfig(
        {
          WAITRON_NODE_ID: f.context.binding.targetNodeId,
          WAITRON_TILL_TIPS: "1",
        },
        "/migrations",
        "/state",
      );
      const settings = { ...config.tillApp };
      await reconcileFirstSetupBeforeMode(config, f.store);
      expect(config.node).toBeUndefined();
      expect(config.tillApp).toStrictEqual(settings);
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
        result: { venue: { nodeId: f.context.binding.targetNodeId } },
      },
      { kind: "publication" },
      { kind: "complete" },
    ] as const)
      state = await f.store.update(f.context.attemptId, state.revision, change);
    await suite.db
      .insert(locations)
      .values([{ id: LOCATION, operationDescription: "Hospitality" }]);
    await seedVenueSettings(suite.db, { name: "Main", invoiceLocales: ["en"] });
    await suite.db
      .insert(nodes)
      .values({ id: f.context.binding.targetNodeId, locationId: LOCATION, name: "Box" });
    const config = loadConfig(
      { WAITRON_NODE_ID: f.context.binding.targetNodeId },
      "/migrations",
      "/state",
    );
    const node = config.node!;
    await reconcileFirstSetupBeforeMode(config, f.store);
    expect(config.node).toEqual(node);
    await expect(
      reconcileFirstSetupBeforeMode(
        { ...config, node: { ...node, nodeId: "other" as typeof node.nodeId } },
        f.store,
      ),
    ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
  } finally {
    await f.dispose();
  }
});

it("a completed setup whose stored result names only the node is accepted", async () => {
  const f = await firstFiscalFixture();
  try {
    let state = (await f.store.read())!;
    for (const change of [
      { kind: "activation-started" },
      { kind: "committed", result: { venue: { nodeId: f.context.binding.targetNodeId } } },
      { kind: "publication" },
      { kind: "complete" },
    ] as const)
      state = await f.store.update(f.context.attemptId, state.revision, change);
    const config = loadConfig(
      { WAITRON_NODE_ID: f.context.binding.targetNodeId },
      "/migrations",
      "/state",
    );
    const node = { ...config.node! };
    await expect(reconcileFirstSetupBeforeMode(config, f.store)).resolves.toBeUndefined();
    expect(config.node).toEqual(node);
  } finally {
    await f.dispose();
  }
});
