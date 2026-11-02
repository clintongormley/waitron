import { getTableConfig } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { captureError, CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  bindingFingerprint,
  HANDOVER_STATES,
  isOpen,
  signEnvelope,
  type HandoverBinding,
} from "@waitron/handover";
import { generateNodeKeyPair } from "@waitron/membership";
import {
  HANDOVER_CLOSED_STATES,
  NODE_MIGRATIONS,
  nodeHandoverOperations,
  readHandoverOperation,
} from "@waitron/node-db";
import { AppError } from "@waitron/shared";
import { advanceHandover, beginHandover, waitHandover } from "./handover-store.js";

const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SOURCE = "11111111-1111-4111-8111-111111111111";
const OP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const BINDING: HandoverBinding = {
  operationId: OP,
  scenario: "controlled",
  venue: { country: "ES", taxId: "B12345678", environment: "preproduction" },
  sourceNodeId: SOURCE,
  destinationNodeId: NODE,
  membership: { term: 3, digest: "a".repeat(64) },
};

describe("the server's handover store", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });
  const deps = () => ({ node: suite.node, nodeId: NODE });

  function events(): { kind: string; detail: string; envelope: string | null }[] {
    return suite.node.all<{ kind: string; detail: string; envelope: string | null }>(
      sql`select kind, detail, envelope from node_handover_events where node_id = ${NODE}`,
    );
  }

  it("begins an operation once at its first state, and answers a repeat as replayed", async () => {
    expect(await beginHandover(deps(), BINDING, "destination")).toBe("created");
    expect(await beginHandover(deps(), BINDING, "destination")).toBe("replayed");
    const row = await readHandoverOperation(suite.node, NODE, OP);
    expect(row).toMatchObject({
      role: "destination",
      scenario: "controlled",
      sourceNodeId: SOURCE,
      destinationNodeId: NODE,
      binding: BINDING,
      fingerprint: bindingFingerprint(BINDING),
      state: "prepared",
      waitingReason: null,
    });
  });

  it("begins an emergency source at source_superseded", async () => {
    const binding = { ...BINDING, scenario: "emergency" as const };
    await beginHandover(deps(), binding, "source");
    expect((await readHandoverOperation(suite.node, NODE, OP))?.state).toBe("source_superseded");
  });

  it("an operation advanced out of order is refused and records nothing", async () => {
    await beginHandover(deps(), BINDING, "destination");
    const error = await captureError(() =>
      advanceHandover(deps(), OP, "activated", { note: "skipped two steps" }),
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("handover.step_out_of_order");
    expect((await readHandoverOperation(suite.node, NODE, OP))?.state).toBe("prepared");
    expect(events()).toEqual([]);
  });

  it("an operation this box has no record of is refused as out of order", async () => {
    const error = await captureError(() => advanceHandover(deps(), OP, "copy_accepted", {}));
    expect((error as AppError).code).toBe("handover.step_out_of_order");
    expect(events()).toEqual([]);
  });

  it("advancing to the same state twice records one event", async () => {
    await beginHandover(deps(), BINDING, "destination");
    const signer = generateNodeKeyPair();
    const envelope = signEnvelope(
      "acceptance",
      { operationId: OP },
      { nodeId: NODE, privateKey: signer.privateKey },
    );
    await advanceHandover(deps(), OP, "copy_accepted", { indicator: "d".repeat(64) }, envelope);
    await advanceHandover(deps(), OP, "copy_accepted", { indicator: "e".repeat(64) }, envelope);
    expect((await readHandoverOperation(suite.node, NODE, OP))?.state).toBe("copy_accepted");
    const recorded = events();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.kind).toBe("copy_accepted");
    expect(JSON.parse(recorded[0]!.detail)).toEqual({ indicator: "d".repeat(64) });
    expect(JSON.parse(recorded[0]!.envelope!)).toEqual(envelope);
  });

  it("records a waiting reason beside the state, and the next step clears it", async () => {
    await beginHandover(deps(), BINDING, "destination");
    await waitHandover(deps(), OP, "handover.step_out_of_order");
    expect(await readHandoverOperation(suite.node, NODE, OP)).toMatchObject({
      state: "prepared",
      waitingReason: "handover.step_out_of_order",
    });
    expect(events()).toEqual([]);
    await advanceHandover(deps(), OP, "copy_accepted", {});
    expect(await readHandoverOperation(suite.node, NODE, OP)).toMatchObject({
      state: "copy_accepted",
      waitingReason: null,
    });
    expect(events().map((e) => e.envelope)).toEqual([null]);
  });

  it("waiting on an operation this box has no record of is a fault", async () => {
    await expect(waitHandover(deps(), OP, "handover.step_out_of_order")).rejects.toThrow(
      `no handover operation ${OP} to wait on`,
    );
  });

  it("node.db accepts exactly the handover package's states, and closes the same ones", () => {
    const column = getTableConfig(nodeHandoverOperations).columns.find((c) => c.name === "state");
    expect([...(column?.enumValues ?? [])].sort()).toEqual([...HANDOVER_STATES].sort());
    expect([...HANDOVER_CLOSED_STATES].sort()).toEqual(
      HANDOVER_STATES.filter((state) => !isOpen(state)).sort(),
    );
  });
});
