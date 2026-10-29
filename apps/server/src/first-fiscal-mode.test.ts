import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { nodes, locations } from "@waitron/db";
import { eq } from "drizzle-orm";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { expect, it } from "vitest";
import { firstFiscalFixture } from "../test/first-fiscal.js";
import { reconcileFirstSetupBeforeMode } from "./first-fiscal-mode.js";
import { loadConfig } from "./config.js";
const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const LOCATION = "55555555-5555-4555-8555-555555555555";
const OTHER_LOCATION = "66666666-6666-4666-8666-666666666666";
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
          result: { venue: { nodeId: f.context.binding.targetNodeId, locationId: LOCATION } },
        });
      if (status === "publication")
        await f.store.update(f.context.attemptId, state.revision, { kind: "publication" });
      const config = loadConfig(
        {
          WAITRON_NODE_ID: f.context.binding.targetNodeId,
          WAITRON_TILL_LOCALE: "ca-ES",
          WAITRON_TILL_TIPS: "1",
        },
        "/migrations",
        "/state",
      );
      const settings = { ...config.tillApp };
      await reconcileFirstSetupBeforeMode(config, f.store, suite.db);
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
        result: { venue: { nodeId: f.context.binding.targetNodeId, locationId: LOCATION } },
      },
      { kind: "publication" },
      { kind: "complete" },
    ] as const)
      state = await f.store.update(f.context.attemptId, state.revision, change);
    await suite.db.insert(locations).values([
      { id: LOCATION, name: "Main", invoiceLocales: ["en"], operationDescription: "Hospitality" },
      {
        id: OTHER_LOCATION,
        name: "Other",
        invoiceLocales: ["en"],
        operationDescription: "Hospitality",
      },
    ]);
    await suite.db
      .insert(nodes)
      .values({ id: f.context.binding.targetNodeId, locationId: LOCATION, name: "Box" });
    const config = loadConfig(
      { WAITRON_NODE_ID: f.context.binding.targetNodeId },
      "/migrations",
      "/state",
    );
    const node = config.node!;
    await reconcileFirstSetupBeforeMode(config, f.store, suite.db);
    expect(config.node).toEqual(node);
    await expect(
      reconcileFirstSetupBeforeMode(
        { ...config, node: { ...node, nodeId: "other" as typeof node.nodeId } },
        f.store,
        suite.db,
      ),
    ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
    await suite.db
      .update(nodes)
      .set({ locationId: OTHER_LOCATION })
      .where(eq(nodes.id, node.nodeId));
    await expect(reconcileFirstSetupBeforeMode(config, f.store, suite.db)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
  } finally {
    await f.dispose();
  }
});
