import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { NodeId } from "@waitron/shared";
import { readHistoryNodes } from "./history-nodes.js";
import { CORE_MIGRATIONS } from "./migrations.js";
import { handoverActivations } from "./schema/index.js";
import { seedNode, seedVenue } from "./testing/seed.js";
import { useVenueDb } from "./testing/venue-db.js";

describe("readHistoryNodes", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  let m1: NodeId;
  let m2: NodeId;
  let m3: NodeId;

  beforeEach(async () => {
    await suite.db.execute(sql`delete from handover_activations`);
    await suite.db.execute(sql`delete from nodes`);
    await seedVenue(suite.db);
    m1 = await seedNode(suite.db);
    m2 = await seedNode(suite.db);
    m3 = await seedNode(suite.db);
  });

  async function handover(source: NodeId, destination: NodeId, activatedAt: string): Promise<void> {
    await suite.db.insert(handoverActivations).values({
      operationId: randomUUID(),
      scenario: "controlled",
      sourceNodeId: source,
      destinationNodeId: destination,
      evidence: {} as never,
      personId: randomUUID(),
      activatedAt,
    });
  }

  it("a box that took over from nobody lists itself only", async () => {
    await handover(m2, m3, "2026-11-01T10:00:00.000Z");

    expect(await readHistoryNodes(suite.db, m1)).toEqual([m1]);
  });

  it("two handovers back are both listed, nearest first", async () => {
    await handover(m1, m2, "2026-11-01T10:00:00.000Z");
    await handover(m2, m3, "2026-11-02T10:00:00.000Z");

    expect(await readHistoryNodes(suite.db, m3)).toEqual([m3, m2, m1]);
    expect(await readHistoryNodes(suite.db, m2)).toEqual([m2, m1]);
  });

  it("a box reached by two paths is listed once", async () => {
    await handover(m1, m2, "2026-11-01T10:00:00.000Z");
    await handover(m2, m3, "2026-11-03T10:00:00.000Z");
    await handover(m1, m3, "2026-11-02T10:00:00.000Z");

    expect(await readHistoryNodes(suite.db, m3)).toEqual([m3, m1, m2]);
  });

  it("a box that handed over and took back is listed once", async () => {
    await handover(m1, m2, "2026-11-01T10:00:00.000Z");
    await handover(m2, m1, "2026-11-02T10:00:00.000Z");

    expect(await readHistoryNodes(suite.db, m1)).toEqual([m1, m2]);
    expect(await readHistoryNodes(suite.db, m2)).toEqual([m2, m1]);
  });
});
