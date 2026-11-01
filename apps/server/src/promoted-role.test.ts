import { describe, expect, it } from "vitest";
import { locationId as brandLocationId } from "@waitron/shared";
import {
  CORE_MIGRATIONS,
  locations,
  stampDeployment,
  writeNodeMembership,
  type Database,
} from "@waitron/db";
import { NODE_MIGRATIONS, readNodeMode, setNodeMode, setSingletonRole } from "@waitron/node-db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  CREDENTIALS_MIGRATIONS,
  loadKeyRing,
  readNodeSigningKey,
  type KeyRing,
} from "@waitron/credentials";
import {
  endorseKey,
  generateNodeKeyPair,
  signDocumentBody,
  type MembershipDocumentBody,
  type NodeStanding,
} from "@waitron/membership";
import { establishNodeIdentity } from "./node-identity.js";
import { finishPromotedRole } from "./promoted-role.js";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xd).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

type LogEntry = { level: string; event: string; detail: unknown };

describe("finishPromotedRole", () => {
  const suite = useVenueDb({
    migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS, NODE_MIGRATIONS],
    timeoutMs: 60_000,
  });

  async function mirrorBox(): Promise<{ nodeId: string; privateKey: string }> {
    const db = suite.db;
    await stampDeployment(db, "preproduction");
    await seedTenant(db);
    const [loc] = await db
      .insert(locations)
      .values({
        name: "Barra",
        invoiceLocales: ["es-ES"],
        operationDescription: "Venta en establecimiento",
      })
      .returning({ id: locations.id });
    const nodeId = await seedNode(db, brandLocationId(loc!.id));
    await establishNodeIdentity({ ownerDb: db, node: suite.node, ring: RING }, nodeId);
    await setNodeMode({ venue: db, node: suite.node }, nodeId, "mirror");
    const privateKey = await readNodeSigningKey(suite.node, RING, nodeId);
    return { nodeId, privateKey: privateKey! };
  }

  function chart(
    nodeId: string,
    standing: NodeStanding,
  ): { body: MembershipDocumentBody; signerNodeId: string } {
    return {
      body: {
        term: 4,
        nodes: [
          { nodeId: "old-primary", contactUrl: "https://old", standing: "sell-only" },
          { nodeId, contactUrl: "", standing },
        ],
      },
      signerNodeId: nodeId,
    };
  }

  async function hold(
    db: Database,
    doc: { body: MembershipDocumentBody; signerNodeId: string },
    privateKey: string,
  ): Promise<void> {
    await writeNodeMembership(db, {
      ...doc,
      signature: signDocumentBody(doc.body, privateKey),
      endorsements: [],
    });
  }

  function run(nodeId: string, venue: Database = suite.db) {
    const entries: LogEntry[] = [];
    const result = finishPromotedRole({
      venue,
      node: suite.node,
      ring: RING,
      nodeId,
      log: (level, event, detail) => {
        entries.push({ level, event, detail });
      },
    });
    return { result, entries };
  }

  it("finishes the role from a chart this box signed naming itself the main box", async () => {
    const { nodeId, privateKey } = await mirrorBox();
    await hold(suite.db, chart(nodeId, "serving-primary"), privateKey);

    const { result, entries } = run(nodeId);

    expect(await result).toBe("finished");
    expect(await readNodeMode(suite.node, nodeId)).toEqual({
      mode: "primary",
      singletonRole: "primary",
    });
    expect(entries).toEqual([
      { level: "warn", event: "promotion.role_finished", detail: { term: 4 } },
    ]);
  });

  it("decides on the axes and chart the caller read, reading neither again", async () => {
    const { nodeId, privateKey } = await mirrorBox();
    const ownChart = chart(nodeId, "serving-primary");
    const held = {
      ...ownChart,
      signature: signDocumentBody(ownChart.body, privateKey),
      endorsements: [],
    };
    const log = () => {};
    const deps = { venue: suite.db, node: suite.node, ring: RING, nodeId, log };

    // node.db says mirror and venue.db holds no chart: only the passed reads can decide either way.
    expect(
      await finishPromotedRole(deps, {
        axes: { mode: "primary", singletonRole: "primary" },
        held,
      }),
    ).toBe("nothing");
    expect(await readNodeMode(suite.node, nodeId)).toEqual({
      mode: "mirror",
      singletonRole: "secondary",
    });

    expect(
      await finishPromotedRole(deps, {
        axes: { mode: "mirror", singletonRole: "secondary" },
        held,
      }),
    ).toBe("finished");
    expect(await readNodeMode(suite.node, nodeId)).toEqual({
      mode: "primary",
      singletonRole: "primary",
    });
  });

  it("finishes a local secondary's singleton role the same way", async () => {
    const { nodeId, privateKey } = await mirrorBox();
    await setNodeMode({ venue: suite.db, node: suite.node }, nodeId, "primary");
    await setSingletonRole({ venue: suite.db, node: suite.node }, nodeId, "secondary");
    await hold(suite.db, chart(nodeId, "serving-primary"), privateKey);

    expect(await run(nodeId).result).toBe("finished");
    expect(await readNodeMode(suite.node, nodeId)).toEqual({
      mode: "primary",
      singletonRole: "primary",
    });
  });

  it("does nothing for a box already primary/primary", async () => {
    const { nodeId } = await mirrorBox();
    await setNodeMode({ venue: suite.db, node: suite.node }, nodeId, "primary");
    await setSingletonRole({ venue: suite.db, node: suite.node }, nodeId, "primary");
    // Any use of the venue handle throws, so a chart read would fail the call.
    const untouchable = new Proxy(suite.db, {
      get() {
        throw new Error("venue.db was read");
      },
    });

    const { result, entries } = run(nodeId, untouchable);

    expect(await result).toBe("nothing");
    expect(entries).toEqual([]);
  });

  it("does nothing when no chart is held", async () => {
    const { nodeId } = await mirrorBox();

    const { result, entries } = run(nodeId);

    expect(await result).toBe("nothing");
    expect(entries).toEqual([]);
    expect(await readNodeMode(suite.node, nodeId)).toEqual({
      mode: "mirror",
      singletonRole: "secondary",
    });
  });

  it("does nothing when the chart this box signed names it anything but the main box", async () => {
    const { nodeId, privateKey } = await mirrorBox();
    await hold(suite.db, chart(nodeId, "serving-secondary"), privateKey);

    expect(await run(nodeId).result).toBe("nothing");
    expect((await readNodeMode(suite.node, nodeId)).mode).toBe("mirror");
  });

  it("does nothing when the chart naming this box the main box was signed by another box", async () => {
    const { nodeId } = await mirrorBox();
    const other = generateNodeKeyPair();
    const doc = chart(nodeId, "serving-primary");
    await hold(suite.db, { ...doc, signerNodeId: "old-primary" }, other.privateKey);

    expect(await run(nodeId).result).toBe("nothing");
    expect((await readNodeMode(suite.node, nodeId)).mode).toBe("mirror");
  });

  it("does nothing when another box signed the chart under this box's endorsement", async () => {
    const { nodeId, privateKey } = await mirrorBox();
    const spare = generateNodeKeyPair();
    const doc = chart(nodeId, "serving-primary");
    await writeNodeMembership(suite.db, {
      body: doc.body,
      signerNodeId: "old-primary",
      signature: signDocumentBody(doc.body, spare.privateKey),
      endorsements: [endorseKey("old-primary", spare.publicKey, nodeId, privateKey)],
    });

    expect(await run(nodeId).result).toBe("nothing");
    expect((await readNodeMode(suite.node, nodeId)).mode).toBe("mirror");
  });

  it("does nothing when the chart claims this box as signer but another key signed it", async () => {
    const { nodeId } = await mirrorBox();
    const forger = generateNodeKeyPair();
    await hold(suite.db, chart(nodeId, "serving-primary"), forger.privateKey);

    expect(await run(nodeId).result).toBe("nothing");
    expect((await readNodeMode(suite.node, nodeId)).mode).toBe("mirror");
  });

  it("refuses, leaving the mode alone, when this box's signing key cannot be opened", async () => {
    const { nodeId, privateKey } = await mirrorBox();
    await hold(suite.db, chart(nodeId, "serving-primary"), privateKey);
    const otherRing = loadKeyRing({
      WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0xe).toString("base64"),
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
    });
    const entries: LogEntry[] = [];

    await expect(
      finishPromotedRole({
        venue: suite.db,
        node: suite.node,
        ring: otherRing,
        nodeId,
        log: (level, event, detail) => {
          entries.push({ level, event, detail });
        },
      }),
    ).rejects.toMatchObject({ code: "credentials.decrypt_failed" });
    expect(entries).toEqual([]);
    expect(await readNodeMode(suite.node, nodeId)).toEqual({
      mode: "mirror",
      singletonRole: "secondary",
    });
  });

  it("does nothing when this box holds no signing key", async () => {
    const { privateKey } = await mirrorBox();
    const keyless = "keyless-spare";
    await setNodeMode({ venue: suite.db, node: suite.node }, keyless, "mirror");
    await hold(suite.db, chart(keyless, "serving-primary"), privateKey);

    expect(await run(keyless).result).toBe("nothing");
    expect((await readNodeMode(suite.node, keyless)).mode).toBe("mirror");
  });
});
