import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { nodes, locations } from "@waitron/db";
import { eq } from "drizzle-orm";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { expect, it } from "vitest";
import { firstFiscalFixture } from "../test/first-fiscal.js";
import { reconcileFirstSetupBeforeMode } from "./first-fiscal-mode.js";
import { type ServerConfig } from "./config.js";
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
      const config = {
        till: { nodeId: f.context.binding.targetNodeId },
      } as ServerConfig;
      await reconcileFirstSetupBeforeMode(config, f.store, suite.db);
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
    const till = { nodeId: f.context.binding.targetNodeId };
    const config = { till } as ServerConfig;
    await reconcileFirstSetupBeforeMode(config, f.store, suite.db);
    expect(config.till).toEqual(till);
    await expect(
      reconcileFirstSetupBeforeMode(
        { till: { ...till, nodeId: "other" } } as ServerConfig,
        f.store,
        suite.db,
      ),
    ).rejects.toMatchObject({ code: "setup.attempt_uncertain" });
    await suite.db
      .update(nodes)
      .set({ locationId: OTHER_LOCATION })
      .where(eq(nodes.id, till.nodeId));
    await expect(reconcileFirstSetupBeforeMode(config, f.store, suite.db)).rejects.toMatchObject({
      code: "setup.attempt_uncertain",
    });
  } finally {
    await f.dispose();
  }
});
