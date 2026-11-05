import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  UNIQUE_VIOLATION,
  captureError,
  checkFailed,
  refusalOn,
  withNodeTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError } from "@waitron/shared";
import * as handover from "./handover.js";
import {
  advanceHandoverOperationTx,
  appendHandoverEventTx,
  beginHandoverOperationTx,
  readHandoverEvent,
  readHandoverOperation,
  readHandoverRestriction,
  readOpenHandoverOperation,
  recordHandoverRestrictionTx,
  type HandoverOperationRow,
  type HandoverRestrictionRow,
} from "./handover.js";
import { NODE_MIGRATIONS } from "./migrations.js";
import { nodeHandoverOperations } from "./schema/node-handover.js";

const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SOURCE = "11111111-1111-4111-8111-111111111111";
const DESTINATION = "22222222-2222-4222-8222-222222222222";
const OP_X = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OP_Y = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const TABLES = ["node_handover_events", "node_handover_operations", "node_handover_restriction"];

function operation(overrides: Partial<HandoverOperationRow> = {}): HandoverOperationRow {
  return {
    nodeId: NODE,
    operationId: OP_X,
    role: "destination",
    scenario: "controlled",
    sourceNodeId: SOURCE,
    destinationNodeId: DESTINATION,
    binding: { operationId: OP_X, scenario: "controlled" },
    fingerprint: "f".repeat(64),
    state: "prepared",
    waitingReason: null,
    ...overrides,
  };
}

const RESTRICTION: HandoverRestrictionRow = {
  nodeId: NODE,
  operationId: OP_X,
  kind: "handed-over",
  successorNodeId: DESTINATION,
  membershipTerm: 4,
};

async function codeOf(fn: () => Promise<unknown>): Promise<unknown> {
  const error = await captureError(fn);
  expect(error).toBeInstanceOf(AppError);
  return error;
}

describe("node.db's handover tables", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });

  function begin(row: HandoverOperationRow) {
    return withNodeTransaction(suite.node, (tx) => beginHandoverOperationTx(tx, row));
  }

  function count(table: string): number {
    const [row] = suite.node.all<{ n: number }>(sql.raw(`select count(*) as n from ${table}`));
    return row!.n;
  }

  it("creates the three tables in node.db and none in venue.db", () => {
    const names = (rows: { name: string }[]) =>
      rows.map((r) => r.name).filter((name) => name.startsWith("node_handover_"));
    expect(
      names(suite.node.all(sql`select name from sqlite_master where type = 'table' order by name`)),
    ).toEqual(TABLES);
    expect(
      names(suite.db.all(sql`select name from sqlite_master where type = 'table' order by name`)),
    ).toEqual([]);
  });

  describe("operations", () => {
    it("names the operations' primary key as the generated migration snapshot does", () => {
      const snapshot = JSON.parse(
        readFileSync(new URL("../drizzle/meta/0001_snapshot.json", import.meta.url), "utf8"),
      ) as { tables: Record<string, { compositePrimaryKeys: Record<string, unknown> }> };
      const [key] = getTableConfig(nodeHandoverOperations).primaryKeys;
      expect(Object.keys(snapshot.tables.node_handover_operations!.compositePrimaryKeys)).toEqual([
        key!.getName(),
      ]);
    });

    it("begins an operation and reads it back for its node only", async () => {
      expect(await begin(operation())).toBe("created");
      const stored = await readHandoverOperation(suite.node, NODE, OP_X);
      expect(stored).toMatchObject(operation());
      expect(stored?.createdAt).toBeInstanceOf(Date);
      expect(stored?.updatedAt).toBeInstanceOf(Date);
      expect(await readHandoverOperation(suite.node, OTHER, OP_X)).toBeNull();
      expect(await readHandoverOperation(suite.node, NODE, OP_Y)).toBeNull();
      expect(await readOpenHandoverOperation(suite.node, NODE)).toMatchObject({
        operationId: OP_X,
      });
      expect(await readOpenHandoverOperation(suite.node, OTHER)).toBeNull();
    });

    it("a second operation while one is open is refused", async () => {
      await begin(operation());
      const error = await codeOf(() => begin(operation({ operationId: OP_Y })));
      expect(error).toMatchObject({
        code: "handover.operation_in_progress",
        params: { operationId: OP_X },
      });
      expect(count("node_handover_operations")).toBe(1);
    });

    it("another box's open operation does not stop this box beginning one", async () => {
      await begin(operation({ nodeId: OTHER }));
      expect(await begin(operation({ operationId: OP_Y }))).toBe("created");
    });

    it("the database itself refuses a second open operation for one box", async () => {
      await begin(operation());
      const at = new Date().toISOString();
      const error = await captureError(() =>
        Promise.resolve(
          suite.node.run(
            sql`insert into node_handover_operations (node_id, operation_id, role, scenario, source_node_id, destination_node_id, binding, fingerprint, state, created_at, updated_at) values (${NODE}, ${OP_Y}, 'source', 'emergency', ${SOURCE}, ${DESTINATION}, '{}', 'x', 'source_superseded', ${at}, ${at})`,
          ),
        ),
      );
      expect(
        refusalOn(error, UNIQUE_VIOLATION, {
          table: "node_handover_operations",
          columns: ["node_id"],
        }),
      ).toBe(true);
    });

    for (const closed of [
      "return_abandoned",
      "return_complete",
      "replaced",
      "abandoned",
    ] as const) {
      it(`a closed operation (${closed}) lets a new one begin`, async () => {
        await begin(operation());
        await withNodeTransaction(suite.node, (tx) =>
          advanceHandoverOperationTx(tx, NODE, OP_X, closed, null),
        );
        expect(await readOpenHandoverOperation(suite.node, NODE)).toBeNull();
        expect(await begin(operation({ operationId: OP_Y }))).toBe("created");
        expect(await readOpenHandoverOperation(suite.node, NODE)).toMatchObject({
          operationId: OP_Y,
        });
      });
    }

    it("closing one operation and beginning the next in one transaction succeeds in that order", async () => {
      await begin(operation({ role: "source", state: "source_stepped_down" }));
      await withNodeTransaction(suite.node, async (tx) => {
        await advanceHandoverOperationTx(tx, NODE, OP_X, "replaced", null);
        expect(
          await beginHandoverOperationTx(
            tx,
            operation({
              operationId: OP_Y,
              role: "source",
              scenario: "emergency",
              state: "source_superseded",
            }),
          ),
        ).toBe("created");
      });
      expect((await readHandoverOperation(suite.node, NODE, OP_X))?.state).toBe("replaced");
      expect((await readOpenHandoverOperation(suite.node, NODE))?.operationId).toBe(OP_Y);
    });

    it("the same operation id with another fingerprint is refused", async () => {
      await begin(operation());
      const error = await codeOf(() => begin(operation({ fingerprint: "e".repeat(64) })));
      expect(error).toMatchObject({
        code: "handover.operation_conflict",
        params: { operationId: OP_X },
      });
      expect((await readHandoverOperation(suite.node, NODE, OP_X))?.fingerprint).toBe(
        "f".repeat(64),
      );
    });

    it("a replay with the same fingerprint answers `replayed` and writes nothing", async () => {
      await begin(operation());
      await withNodeTransaction(suite.node, (tx) =>
        advanceHandoverOperationTx(tx, NODE, OP_X, "copy_accepted", null),
      );
      const before = suite.node.all(sql`select * from node_handover_operations`);
      expect(await begin(operation({ state: "prepared", waitingReason: "x.y" }))).toBe("replayed");
      expect(suite.node.all(sql`select * from node_handover_operations`)).toEqual(before);
    });

    it("a replay of a closed operation answers `replayed` too", async () => {
      await begin(operation());
      await withNodeTransaction(suite.node, (tx) =>
        advanceHandoverOperationTx(tx, NODE, OP_X, "abandoned", null),
      );
      expect(await begin(operation())).toBe("replayed");
    });

    it("advances the state, records a waiting reason and moves updated_at", async () => {
      await begin(operation());
      const first = await readHandoverOperation(suite.node, NODE, OP_X);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await withNodeTransaction(suite.node, (tx) =>
        advanceHandoverOperationTx(tx, NODE, OP_X, "copy_accepted", "handover.peer_silent"),
      );
      const second = await readHandoverOperation(suite.node, NODE, OP_X);
      expect(second?.state).toBe("copy_accepted");
      expect(second?.waitingReason).toBe("handover.peer_silent");
      expect(second?.createdAt).toEqual(first?.createdAt);
      expect(second!.updatedAt.getTime()).toBeGreaterThan(first!.updatedAt.getTime());
      await withNodeTransaction(suite.node, (tx) =>
        advanceHandoverOperationTx(tx, NODE, OP_X, "copy_accepted", null),
      );
      expect((await readHandoverOperation(suite.node, NODE, OP_X))?.waitingReason).toBeNull();
    });

    it("advances only the named box's operation", async () => {
      await begin(operation());
      await begin(operation({ nodeId: OTHER }));
      await withNodeTransaction(suite.node, (tx) =>
        advanceHandoverOperationTx(tx, NODE, OP_X, "copy_accepted", null),
      );
      expect((await readHandoverOperation(suite.node, OTHER, OP_X))?.state).toBe("prepared");
    });

    it("advancing an operation this box has no row for is a fault, not a silent no-op", async () => {
      await expect(
        withNodeTransaction(suite.node, (tx) =>
          advanceHandoverOperationTx(tx, NODE, OP_Y, "copy_accepted", null),
        ),
      ).rejects.toThrow(`no handover operation ${OP_Y} for node ${NODE}`);
    });

    it("the database refuses a state, role or scenario outside its vocabulary", async () => {
      await begin(operation());
      for (const [column, value] of [
        ["state", "finished"],
        ["role", "bystander"],
        ["scenario", "planned"],
      ] as const) {
        const error = await captureError(() =>
          Promise.resolve(
            suite.node.run(
              sql`update node_handover_operations set ${sql.raw(column)} = ${value} where node_id = ${NODE}`,
            ),
          ),
        );
        expect(checkFailed(error, `node_handover_operations_${column}_ck`)).toBe(true);
      }
    });
  });

  describe("events", () => {
    it("appends events, with and without an operation, in node.db", async () => {
      await withNodeTransaction(suite.node, async (tx) => {
        await appendHandoverEventTx(tx, {
          nodeId: NODE,
          operationId: OP_X,
          kind: "final_state",
          detail: { digest: "d" },
          envelope: '{"purpose":"waitron.handover.final-state.v1"}',
        });
        await appendHandoverEventTx(tx, {
          nodeId: NODE,
          operationId: null,
          kind: "carry_on",
          detail: {},
          envelope: null,
        });
      });
      const rows = suite.node.all<Record<string, unknown>>(
        sql`select node_id, operation_id, kind, detail, envelope, event_id, recorded_at from node_handover_events order by kind`,
      );
      expect(
        rows.map((row) => ({
          node_id: row.node_id,
          operation_id: row.operation_id,
          kind: row.kind,
          detail: row.detail,
          envelope: row.envelope,
        })),
      ).toEqual([
        { node_id: NODE, operation_id: null, kind: "carry_on", detail: "{}", envelope: null },
        {
          node_id: NODE,
          operation_id: OP_X,
          kind: "final_state",
          detail: '{"digest":"d"}',
          envelope: '{"purpose":"waitron.handover.final-state.v1"}',
        },
      ]);
      expect(new Set(rows.map((r) => r.event_id)).size).toBe(2);
      for (const row of rows) {
        expect(row.event_id).toMatch(/^[0-9a-f-]{36}$/);
        expect(Number.isNaN(Date.parse(String(row.recorded_at)))).toBe(false);
      }
    });

    describe("reading one back", () => {
      function append(nodeId: string, operationId: string | null, kind: string, envelope: string) {
        return withNodeTransaction(suite.node, (tx) =>
          appendHandoverEventTx(tx, { nodeId, operationId, kind, detail: { envelope }, envelope }),
        );
      }

      it("answers the first event of that kind for that box and operation", async () => {
        await append(OTHER, OP_X, "final_state", "another box");
        await append(NODE, OP_Y, "final_state", "another operation");
        await append(NODE, OP_X, "relinquished", "another kind");
        await append(NODE, null, "final_state", "no operation");
        await append(NODE, OP_X, "final_state", "first");
        await append(NODE, OP_X, "final_state", "second");

        const event = await readHandoverEvent(suite.node, NODE, OP_X, "final_state");
        expect(event).toMatchObject({
          nodeId: NODE,
          operationId: OP_X,
          kind: "final_state",
          envelope: "first",
          detail: { envelope: "first" },
        });
      });

      it("reads inside a transaction", async () => {
        const seen = await withNodeTransaction(suite.node, async (tx) => {
          await appendHandoverEventTx(tx, {
            nodeId: NODE,
            operationId: OP_X,
            kind: "final_state",
            detail: {},
            envelope: "in the transaction",
          });
          return readHandoverEvent(tx, NODE, OP_X, "final_state");
        });
        expect(seen?.envelope).toBe("in the transaction");
      });

      it("answers null when each of the box, the operation or the kind differs", async () => {
        await append(NODE, OP_X, "final_state", "only");
        expect(await readHandoverEvent(suite.node, OTHER, OP_X, "final_state")).toBeNull();
        expect(await readHandoverEvent(suite.node, NODE, OP_Y, "final_state")).toBeNull();
        expect(await readHandoverEvent(suite.node, NODE, OP_X, "relinquished")).toBeNull();
      });
    });

    it("an event is never updated: the module exports no update or delete", () => {
      expect(Object.keys(handover).sort()).toEqual(
        [
          "HANDOVER_CLOSED_STATES",
          "advanceHandoverOperationTx",
          "appendHandoverEventTx",
          "beginHandoverOperationTx",
          "readHandoverEvent",
          "readHandoverOperation",
          "readHandoverRestriction",
          "readOpenHandoverOperation",
          "recordHandoverRestrictionTx",
        ].sort(),
      );
    });

    it("names the four closing states", () => {
      expect([...handover.HANDOVER_CLOSED_STATES].sort()).toEqual(
        ["abandoned", "replaced", "return_abandoned", "return_complete"].sort(),
      );
    });
  });

  describe("restriction", () => {
    function record(row: HandoverRestrictionRow) {
      return withNodeTransaction(suite.node, (tx) => recordHandoverRestrictionTx(tx, row));
    }

    it("reads null before any write, and the row after, for its node only", async () => {
      expect(await readHandoverRestriction(suite.node, NODE)).toBeNull();
      await record(RESTRICTION);
      const stored = await readHandoverRestriction(suite.node, NODE);
      expect(stored).toMatchObject(RESTRICTION);
      expect(stored?.recordedAt).toBeInstanceOf(Date);
      expect(await readHandoverRestriction(suite.node, OTHER)).toBeNull();
    });

    it("a chart-only supersession has no operation", async () => {
      await record({ ...RESTRICTION, operationId: null, kind: "superseded" });
      expect(await readHandoverRestriction(suite.node, NODE)).toMatchObject({
        operationId: null,
        kind: "superseded",
      });
    });

    it("a second write with the same values is a no-op", async () => {
      await record(RESTRICTION);
      const before = suite.node.all(sql`select * from node_handover_restriction`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await record(RESTRICTION);
      expect(suite.node.all(sql`select * from node_handover_restriction`)).toEqual(before);
    });

    for (const [field, value] of [
      ["operationId", OP_Y],
      ["operationId", null],
      ["kind", "superseded"],
      ["successorNodeId", SOURCE],
      ["membershipTerm", 5],
    ] as const) {
      it(`a restriction rewritten with another ${field} is refused`, async () => {
        await record(RESTRICTION);
        const error = await codeOf(() => record({ ...RESTRICTION, [field]: value }));
        expect(error).toMatchObject({ code: "handover.restriction_conflict" });
        expect(await readHandoverRestriction(suite.node, NODE)).toMatchObject(RESTRICTION);
      });
    }

    it("another box's restriction is its own row", async () => {
      await record(RESTRICTION);
      await record({ ...RESTRICTION, nodeId: OTHER, kind: "superseded" });
      expect((await readHandoverRestriction(suite.node, NODE))?.kind).toBe("handed-over");
      expect((await readHandoverRestriction(suite.node, OTHER))?.kind).toBe("superseded");
    });

    it("the database refuses a kind outside its vocabulary", async () => {
      await record(RESTRICTION);
      const error = await captureError(() =>
        Promise.resolve(suite.node.run(sql`update node_handover_restriction set kind = 'paused'`)),
      );
      expect(checkFailed(error, "node_handover_restriction_kind_ck")).toBe(true);
    });
  });
});
