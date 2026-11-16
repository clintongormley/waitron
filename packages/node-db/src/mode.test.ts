import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  captureError,
  engineErrorMessage,
  isRefusal,
  readDeploymentEnvironment,
  stampDeployment,
  withNodeTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { NODE_MIGRATIONS } from "./migrations.js";
import { nodeHandoverEvents } from "./schema/node-handover.js";
import {
  readNodeMode,
  readNodeModeRow,
  setNodeMode,
  setNodeModeTx,
  setPrimaryRoleTx,
  setSingletonRole,
  setSingletonRoleTx,
} from "./mode.js";

const NODE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("a node file with no migration set applied", () => {
  const bare = useVenueDb({ migrations: [] });

  // Every start migrates node.db before reading it; an unmigrated file is refused, never read as a
  // sole primary.
  it("is refused rather than read as a sole primary", async () => {
    await expect(readNodeMode(bare.node, NODE)).rejects.toThrow(/no such table: box/);
  });
});

describe("the role in node.db", () => {
  const suite = useVenueDb({
    migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS],
  });
  const handles = () => ({ venue: suite.db, node: suite.node });
  const events = () =>
    suite.node
      .select({
        nodeId: nodeHandoverEvents.nodeId,
        operationId: nodeHandoverEvents.operationId,
        kind: nodeHandoverEvents.kind,
        detail: nodeHandoverEvents.detail,
        envelope: nodeHandoverEvents.envelope,
      })
      .from(nodeHandoverEvents)
      .orderBy(sql`rowid`);

  it("records each changed role with its cause, without repeating an unchanged role", async () => {
    await stampDeployment(suite.db, "preproduction");
    await setNodeMode(handles(), NODE, "mirror", "adopt");
    await setNodeMode(handles(), NODE, "mirror", "adopt");
    await setNodeMode(handles(), NODE, "primary", "promote");
    await setSingletonRole(handles(), NODE, "primary", "promote");
    await setSingletonRole(handles(), NODE, "secondary", "fenced");
    expect(await events()).toEqual([
      {
        nodeId: NODE,
        operationId: null,
        kind: "box.role_changed",
        detail: { mode: "mirror", singletonRole: "secondary", cause: "adopt" },
        envelope: null,
      },
      {
        nodeId: NODE,
        operationId: null,
        kind: "box.role_changed",
        detail: { mode: "primary", singletonRole: "secondary", cause: "promote" },
        envelope: null,
      },
      {
        nodeId: NODE,
        operationId: null,
        kind: "box.role_changed",
        detail: { mode: "primary", singletonRole: "primary", cause: "promote" },
        envelope: null,
      },
      {
        nodeId: NODE,
        operationId: null,
        kind: "box.role_changed",
        detail: { mode: "primary", singletonRole: "secondary", cause: "fenced" },
        envelope: null,
      },
    ]);
  });

  it("fills absent and empty role groups without recording a change from sole primary", async () => {
    suite.node.run(sql`insert into box (node_id) values (${OTHER})`);
    await withNodeTransaction(suite.node, async (tx) => {
      await setNodeModeTx(tx, NODE, "primary", "promote");
      await setSingletonRoleTx(tx, OTHER, "primary", "promote");
      await setPrimaryRoleTx(tx, NODE, "promote");
    });
    expect(await readNodeModeRow(suite.node, NODE)).toEqual({
      mode: "primary",
      singletonRole: "primary",
    });
    expect(await readNodeModeRow(suite.node, OTHER)).toEqual({
      mode: "primary",
      singletonRole: "primary",
    });
    expect(await events()).toEqual([]);
  });

  it("reads as a sole primary when the node has no row", async () => {
    expect(await readNodeMode(suite.node, NODE)).toEqual({
      mode: "primary",
      singletonRole: "primary",
    });
  });

  it("the row reader answers null for a node with no row, and readNodeMode still answers primary", async () => {
    expect(await readNodeModeRow(suite.node, NODE)).toBeNull();
    expect(await readNodeMode(suite.node, NODE)).toEqual({
      mode: "primary",
      singletonRole: "primary",
    });
    await stampDeployment(suite.db, "preproduction");
    await setNodeMode(handles(), OTHER, "mirror", "adopt");
    expect(await readNodeModeRow(suite.node, NODE)).toBeNull();
    expect(await readNodeModeRow(suite.node, OTHER)).toEqual({
      mode: "mirror",
      singletonRole: "secondary",
    });
  });

  it("refuses a mode write while venue.db is unstamped, and writes nothing", async () => {
    const error = await rejection(setNodeMode(handles(), NODE, "mirror", "adopt"));
    expect(error).toMatchObject({ code: "deployment.not_stamped" });
    expect(suite.node.all(sql`select node_id from box`)).toEqual([]);
  });

  it("refuses a singleton-role write while venue.db is unstamped, and writes nothing", async () => {
    const error = await rejection(setSingletonRole(handles(), NODE, "secondary", "fenced"));
    expect(error).toMatchObject({ code: "deployment.not_stamped" });
    expect(suite.node.all(sql`select node_id from box`)).toEqual([]);
  });

  it("a mirror co-sets secondary, and primary keeps the singleton role as it is", async () => {
    await stampDeployment(suite.db, "preproduction");
    await setNodeMode(handles(), NODE, "mirror", "adopt");
    expect(await readNodeMode(suite.node, NODE)).toEqual({
      mode: "mirror",
      singletonRole: "secondary",
    });
    await setNodeMode(handles(), NODE, "primary", "promote");
    expect(await readNodeMode(suite.node, NODE)).toEqual({
      mode: "primary",
      singletonRole: "secondary",
    });
    await setSingletonRole(handles(), NODE, "primary", "fenced");
    await setNodeMode(handles(), NODE, "primary", "promote");
    expect(await readNodeMode(suite.node, NODE)).toEqual({
      mode: "primary",
      singletonRole: "primary",
    });
    await setNodeMode(handles(), NODE, "mirror", "adopt");
    expect(await readNodeMode(suite.node, NODE)).toEqual({
      mode: "mirror",
      singletonRole: "secondary",
    });
  });

  it("a first mode write of primary creates a sole primary row", async () => {
    await stampDeployment(suite.db, "preproduction");
    await setNodeMode(handles(), NODE, "primary", "promote");
    expect(suite.node.all(sql`select node_id, mode, singleton_role from box`)).toEqual([
      { node_id: NODE, mode: "primary", singleton_role: "primary" },
    ]);
  });

  it("a first singleton-role write creates the row with mode primary", async () => {
    await stampDeployment(suite.db, "preproduction");
    await setSingletonRole(handles(), NODE, "secondary", "fenced");
    expect(await readNodeMode(suite.node, NODE)).toEqual({
      mode: "primary",
      singletonRole: "secondary",
    });
    await setSingletonRole(handles(), NODE, "primary", "fenced");
    expect(await readNodeMode(suite.node, NODE)).toEqual({
      mode: "primary",
      singletonRole: "primary",
    });
  });

  it("keeps each node's row apart", async () => {
    await stampDeployment(suite.db, "preproduction");
    await setNodeMode(handles(), NODE, "mirror", "adopt");
    expect(await readNodeMode(suite.node, OTHER)).toEqual({
      mode: "primary",
      singletonRole: "primary",
    });
    await setSingletonRole(handles(), OTHER, "secondary", "fenced");
    expect(await readNodeMode(suite.node, NODE)).toEqual({
      mode: "mirror",
      singletonRole: "secondary",
    });
  });

  it("keeps the environment one per database, whichever node's role is written", async () => {
    await stampDeployment(suite.db, "production");
    await setNodeMode(handles(), NODE, "mirror", "adopt");
    await setSingletonRole(handles(), OTHER, "secondary", "fenced");
    expect(await readDeploymentEnvironment(suite.db)).toBe("production");
  });

  it("refuses the singleton duties on a mirror (box_role_valid_ck)", async () => {
    await stampDeployment(suite.db, "preproduction");
    await setNodeMode(handles(), NODE, "mirror", "adopt");
    const before = await events();
    const error = await captureError(() => setSingletonRole(handles(), NODE, "primary", "fenced"));
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/box_role_valid_ck/);
    expect(await events()).toEqual(before);
  });

  it("the mode CHECK rejects any value outside primary/mirror", async () => {
    const error = await captureError(() =>
      Promise.resolve(
        suite.node.run(
          sql`insert into box (node_id, mode, singleton_role, role_changed_at) values (${NODE}, 'bogus', 'secondary', ${new Date().toISOString()})`,
        ),
      ),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/box_mode_ck/);
  });

  it("a mode write goes to mirror and back to primary, the legitimate reverse", async () => {
    await stampDeployment(suite.db, "preproduction");
    expect((await readNodeMode(suite.node, NODE)).mode).toBe("primary");
    await setNodeMode(handles(), NODE, "mirror", "adopt");
    expect((await readNodeMode(suite.node, NODE)).mode).toBe("mirror");
    await setNodeMode(handles(), NODE, "primary", "promote");
    expect((await readNodeMode(suite.node, NODE)).mode).toBe("primary");
  });

  it("a primary mode write leaves a sell-only secondary's singleton role as it is", async () => {
    await stampDeployment(suite.db, "preproduction");
    await setSingletonRole(handles(), NODE, "secondary", "fenced");
    await setNodeMode(handles(), NODE, "primary", "promote");
    expect(await readNodeMode(suite.node, NODE)).toEqual({
      mode: "primary",
      singletonRole: "secondary",
    });
  });

  it("a mirror becomes a sole primary in one node transaction, mode first", async () => {
    await stampDeployment(suite.db, "preproduction");
    await setSingletonRole(handles(), NODE, "secondary", "fenced");
    await setNodeMode(handles(), NODE, "mirror", "adopt");
    await withNodeTransaction(suite.node, async (tx) => {
      await setNodeModeTx(tx, NODE, "primary", "promote");
      await setSingletonRoleTx(tx, NODE, "primary", "fenced");
    });
    expect(await readNodeMode(suite.node, NODE)).toEqual({
      mode: "primary",
      singletonRole: "primary",
    });
  });

  it("the transaction forms write without reading the stamp, and roll back with their body", async () => {
    await withNodeTransaction(suite.node, async (tx) => {
      await setNodeModeTx(tx, NODE, "mirror", "adopt");
      await setSingletonRoleTx(tx, OTHER, "secondary", "fenced");
    });
    expect(await readNodeMode(suite.node, NODE)).toEqual({
      mode: "mirror",
      singletonRole: "secondary",
    });
    expect(await readNodeMode(suite.node, OTHER)).toEqual({
      mode: "primary",
      singletonRole: "secondary",
    });
    const before = await events();
    await expect(
      withNodeTransaction(suite.node, async (tx) => {
        await setNodeModeTx(tx, NODE, "primary", "promote");
        throw new Error("abandoned");
      }),
    ).rejects.toThrow("abandoned");
    expect((await readNodeMode(suite.node, NODE)).mode).toBe("mirror");
    expect(await events()).toEqual(before);
  });

  it("moves updated_at on every write", async () => {
    await stampDeployment(suite.db, "preproduction");
    await setNodeMode(handles(), NODE, "mirror", "adopt");
    suite.node.run(sql`update box set role_changed_at = '2000-01-01T00:00:00.000Z'`);
    await setNodeMode(handles(), NODE, "primary", "promote");
    const [afterMode] = suite.node.all<{ updated_at: string }>(
      sql`select role_changed_at as updated_at from box`,
    );
    expect(afterMode?.updated_at).not.toBe("2000-01-01T00:00:00.000Z");
    suite.node.run(sql`update box set role_changed_at = '2000-01-01T00:00:00.000Z'`);
    await setSingletonRole(handles(), NODE, "primary", "fenced");
    const [afterRole] = suite.node.all<{ updated_at: string }>(
      sql`select role_changed_at as updated_at from box`,
    );
    expect(afterRole?.updated_at).not.toBe("2000-01-01T00:00:00.000Z");
  });

  it.each([
    ["a mirror", "mirror", "secondary"],
    ["a primary standing by as secondary", "primary", "secondary"],
  ] as const)(
    "makes %s the sole primary, inside the caller's transaction",
    async (_label, mode, singletonRole) => {
      suite.node.run(
        sql`insert into box (node_id, mode, singleton_role, role_changed_at)
          values (${NODE}, ${mode}, ${singletonRole}, '2000-01-01T00:00:00.000Z')`,
      );
      await withNodeTransaction(suite.node, (tx) => setPrimaryRoleTx(tx, NODE, "promote"));
      await withNodeTransaction(suite.node, (tx) => setPrimaryRoleTx(tx, NODE, "promote"));
      expect(await readNodeMode(suite.node, NODE)).toEqual({
        mode: "primary",
        singletonRole: "primary",
      });
      expect(await events()).toEqual([
        {
          nodeId: NODE,
          operationId: null,
          kind: "box.role_changed",
          detail: { mode: "primary", singletonRole: "primary", cause: "promote" },
          envelope: null,
        },
      ]);
    },
  );

  it("makes a node with no row the sole primary, and leaves other nodes alone", async () => {
    await withNodeTransaction(suite.node, async (tx) => {
      await setNodeModeTx(tx, OTHER, "mirror", "adopt");
      await setPrimaryRoleTx(tx, NODE, "promote");
    });
    expect(await readNodeMode(suite.node, NODE)).toEqual({
      mode: "primary",
      singletonRole: "primary",
    });
    expect(await readNodeMode(suite.node, OTHER)).toEqual({
      mode: "mirror",
      singletonRole: "secondary",
    });
  });
});
