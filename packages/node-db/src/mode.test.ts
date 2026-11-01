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
import {
  readNodeMode,
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

  it("reads as a sole primary", async () => {
    expect(await readNodeMode(bare.node, NODE)).toEqual({
      mode: "primary",
      singletonRole: "primary",
    });
  });
});

describe("the role in node.db", () => {
  const suite = useVenueDb({
    migrations: [CORE_MIGRATIONS, { ...NODE_MIGRATIONS, database: "node" }],
  });
  const handles = () => ({ venue: suite.db, node: suite.node });

  it("reads as a sole primary when the node has no row", async () => {
    expect(await readNodeMode(suite.node, NODE)).toEqual({
      mode: "primary",
      singletonRole: "primary",
    });
  });

  it("refuses a mode write while venue.db is unstamped, and writes nothing", async () => {
    const error = await rejection(setNodeMode(handles(), NODE, "mirror"));
    expect(error).toMatchObject({ code: "deployment.not_stamped" });
    expect(suite.node.all(sql`select node_id from node_mode`)).toEqual([]);
  });

  it("refuses a singleton-role write while venue.db is unstamped, and writes nothing", async () => {
    const error = await rejection(setSingletonRole(handles(), NODE, "secondary"));
    expect(error).toMatchObject({ code: "deployment.not_stamped" });
    expect(suite.node.all(sql`select node_id from node_mode`)).toEqual([]);
  });

  it("a mirror co-sets secondary, and primary keeps the singleton role as it is", async () => {
    await stampDeployment(suite.db, "preproduction");
    await setNodeMode(handles(), NODE, "mirror");
    expect(await readNodeMode(suite.node, NODE)).toEqual({
      mode: "mirror",
      singletonRole: "secondary",
    });
    await setNodeMode(handles(), NODE, "primary");
    expect(await readNodeMode(suite.node, NODE)).toEqual({
      mode: "primary",
      singletonRole: "secondary",
    });
    await setSingletonRole(handles(), NODE, "primary");
    await setNodeMode(handles(), NODE, "primary");
    expect(await readNodeMode(suite.node, NODE)).toEqual({
      mode: "primary",
      singletonRole: "primary",
    });
    await setNodeMode(handles(), NODE, "mirror");
    expect(await readNodeMode(suite.node, NODE)).toEqual({
      mode: "mirror",
      singletonRole: "secondary",
    });
  });

  it("a first mode write of primary creates a sole primary row", async () => {
    await stampDeployment(suite.db, "preproduction");
    await setNodeMode(handles(), NODE, "primary");
    expect(suite.node.all(sql`select node_id, mode, singleton_role from node_mode`)).toEqual([
      { node_id: NODE, mode: "primary", singleton_role: "primary" },
    ]);
  });

  it("a first singleton-role write creates the row with mode primary", async () => {
    await stampDeployment(suite.db, "preproduction");
    await setSingletonRole(handles(), NODE, "secondary");
    expect(await readNodeMode(suite.node, NODE)).toEqual({
      mode: "primary",
      singletonRole: "secondary",
    });
    await setSingletonRole(handles(), NODE, "primary");
    expect(await readNodeMode(suite.node, NODE)).toEqual({
      mode: "primary",
      singletonRole: "primary",
    });
  });

  it("keeps each node's row apart", async () => {
    await stampDeployment(suite.db, "preproduction");
    await setNodeMode(handles(), NODE, "mirror");
    expect(await readNodeMode(suite.node, OTHER)).toEqual({
      mode: "primary",
      singletonRole: "primary",
    });
    await setSingletonRole(handles(), OTHER, "secondary");
    expect(await readNodeMode(suite.node, NODE)).toEqual({
      mode: "mirror",
      singletonRole: "secondary",
    });
  });

  it("keeps the environment one per database, whichever node's role is written", async () => {
    await stampDeployment(suite.db, "production");
    await setNodeMode(handles(), NODE, "mirror");
    await setSingletonRole(handles(), OTHER, "secondary");
    expect(await readDeploymentEnvironment(suite.db)).toBe("production");
  });

  it("refuses the singleton duties on a mirror (node_mode_role_valid_ck)", async () => {
    await stampDeployment(suite.db, "preproduction");
    await setNodeMode(handles(), NODE, "mirror");
    const error = await captureError(() => setSingletonRole(handles(), NODE, "primary"));
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/node_mode_role_valid_ck/);
  });

  it("the mode CHECK rejects any value outside primary/mirror", async () => {
    const error = await captureError(() =>
      Promise.resolve(
        suite.node.run(
          sql`insert into node_mode (node_id, mode, updated_at) values (${NODE}, 'bogus', ${new Date().toISOString()})`,
        ),
      ),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/node_mode_mode_ck/);
  });

  it("a mode write goes to mirror and back to primary, the legitimate reverse", async () => {
    await stampDeployment(suite.db, "preproduction");
    expect((await readNodeMode(suite.node, NODE)).mode).toBe("primary");
    await setNodeMode(handles(), NODE, "mirror");
    expect((await readNodeMode(suite.node, NODE)).mode).toBe("mirror");
    await setNodeMode(handles(), NODE, "primary");
    expect((await readNodeMode(suite.node, NODE)).mode).toBe("primary");
  });

  it("a primary mode write leaves a sell-only secondary's singleton role as it is", async () => {
    await stampDeployment(suite.db, "preproduction");
    await setSingletonRole(handles(), NODE, "secondary");
    await setNodeMode(handles(), NODE, "primary");
    expect(await readNodeMode(suite.node, NODE)).toEqual({
      mode: "primary",
      singletonRole: "secondary",
    });
  });

  it("a mirror becomes a sole primary in one node transaction, mode first", async () => {
    await stampDeployment(suite.db, "preproduction");
    await setSingletonRole(handles(), NODE, "secondary");
    await setNodeMode(handles(), NODE, "mirror");
    await withNodeTransaction(suite.node, async (tx) => {
      await setNodeModeTx(tx, NODE, "primary");
      await setSingletonRoleTx(tx, NODE, "primary");
    });
    expect(await readNodeMode(suite.node, NODE)).toEqual({
      mode: "primary",
      singletonRole: "primary",
    });
  });

  it("the transaction forms write without reading the stamp, and roll back with their body", async () => {
    await withNodeTransaction(suite.node, async (tx) => {
      await setNodeModeTx(tx, NODE, "mirror");
      await setSingletonRoleTx(tx, OTHER, "secondary");
    });
    expect(await readNodeMode(suite.node, NODE)).toEqual({
      mode: "mirror",
      singletonRole: "secondary",
    });
    expect(await readNodeMode(suite.node, OTHER)).toEqual({
      mode: "primary",
      singletonRole: "secondary",
    });
    await expect(
      withNodeTransaction(suite.node, async (tx) => {
        await setNodeModeTx(tx, NODE, "primary");
        throw new Error("abandoned");
      }),
    ).rejects.toThrow("abandoned");
    expect((await readNodeMode(suite.node, NODE)).mode).toBe("mirror");
  });

  it("moves updated_at on every write", async () => {
    await stampDeployment(suite.db, "preproduction");
    await setNodeMode(handles(), NODE, "mirror");
    suite.node.run(sql`update node_mode set updated_at = '2000-01-01T00:00:00.000Z'`);
    await setNodeMode(handles(), NODE, "primary");
    const [afterMode] = suite.node.all<{ updated_at: string }>(
      sql`select updated_at from node_mode`,
    );
    expect(afterMode?.updated_at).not.toBe("2000-01-01T00:00:00.000Z");
    suite.node.run(sql`update node_mode set updated_at = '2000-01-01T00:00:00.000Z'`);
    await setSingletonRole(handles(), NODE, "primary");
    const [afterRole] = suite.node.all<{ updated_at: string }>(
      sql`select updated_at from node_mode`,
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
        sql`insert into node_mode (node_id, mode, singleton_role, updated_at)
          values (${NODE}, ${mode}, ${singletonRole}, '2000-01-01T00:00:00.000Z')`,
      );
      await withNodeTransaction(suite.node, (tx) => setPrimaryRoleTx(tx, NODE));
      expect(await readNodeMode(suite.node, NODE)).toEqual({
        mode: "primary",
        singletonRole: "primary",
      });
    },
  );

  it("makes a node with no row the sole primary, and leaves other nodes alone", async () => {
    await withNodeTransaction(suite.node, async (tx) => {
      await setNodeModeTx(tx, OTHER, "mirror");
      await setPrimaryRoleTx(tx, NODE);
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
