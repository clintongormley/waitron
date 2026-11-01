import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  locations,
  openVenueDatabase,
  readNodeMembership,
  stampDeployment,
  writeNodeMembership,
  type Database,
  type NodeDatabase,
  type VenueDatabase,
} from "@waitron/db";
import { NODE_FILE, VENUE_FILE } from "@waitron/store";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  readNodeMode,
  readPinnedPrimaryKey,
  readRecoveryKeyVerifier,
  setNodeMode,
} from "@waitron/node-db";
import {
  loadKeyRing,
  nodeSigningPublicKey,
  readNodeSigningKey,
  type KeyRing,
} from "@waitron/credentials";
import {
  signDocumentBody,
  type MembershipDocumentBody,
  type NodeStanding,
} from "@waitron/membership";
import { verifySecretAsync } from "@waitron/identity";
import { locationId as brandLocationId } from "@waitron/shared";
import { adoptFromPrimary } from "./adopt.js";
import { assembleMirrorBundle } from "./mirror-bundle.js";
import { establishNodeIdentity } from "./node-identity.js";
import { mintBreakGlassSecret } from "./break-glass.js";
import { keyRingEnv, type EncodedKeyRing } from "./box-secrets.js";
import { createDeploymentHolders, refreshDeploymentHolders } from "./deployment-holders.js";
import { finishPromotedRole } from "./promoted-role.js";

// No module reserves anything for the standby, so A's bundle needs no module operation.
vi.mock("./modules.js", () => ({ ALL_MODULES: [] }));

const RING_A = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x3a).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
// The ring B boots with before it joins; joining replaces it with A's.
const RING_B_OWN = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 0x3b).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

interface Box {
  dir: string;
  store: VenueDatabase;
  venue: Database;
  node: NodeDatabase;
  id: string;
}

const scratch: string[] = [];
const open: VenueDatabase[] = [];

async function migratedFolder(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  scratch.push(dir);
  await applyMigrations(dir, migrationOptionsFor(manifestSets(), null));
  return dir;
}

async function openStore(dir: string): Promise<VenueDatabase> {
  const store = await openVenueDatabase(dir);
  open.push(store);
  return store;
}

async function close(store: VenueDatabase): Promise<void> {
  open.splice(open.indexOf(store), 1);
  await store.close();
}

let a: { id: string; publicKey: string; secret: string; dir: string };
let b: { id: string; secret: string; dir: string; ring: KeyRing; nodeBytes: Buffer };
let copiedTerm: number;

function chartBody(term: number, nodes: MembershipDocumentBody["nodes"]): MembershipDocumentBody {
  return { term, nodes };
}

beforeAll(async () => {
  // Box A: a stamped primary with its signing key, a recovery key and a chart naming it main box.
  const aDir = await migratedFolder("waitron-copy-a-");
  const aState = await mkdtemp(join(tmpdir(), "waitron-copy-a-state-"));
  scratch.push(aState);
  await mkdir(join(aState, "tls"));
  await writeFile(join(aState, "tls", "ca.crt"), "public-test-ca");
  await writeFile(join(aState, "tls", "ca.key"), "public-test-ca-key");
  const aStore = await openStore(aDir);
  await stampDeployment(aStore.venue, "preproduction");
  await seedTenant(aStore.venue);
  const [loc] = await aStore.venue
    .insert(locations)
    .values({
      name: "Barra",
      invoiceLocales: ["es-ES"],
      operationDescription: "Venta en establecimiento",
    })
    .returning({ id: locations.id });
  const aId = await seedNode(aStore.venue, brandLocationId(loc!.id));
  await establishNodeIdentity({ ownerDb: aStore.venue, node: aStore.node, ring: RING_A }, aId);
  await setNodeMode({ venue: aStore.venue, node: aStore.node }, aId, "primary");
  const aSecret = await mintBreakGlassSecret({ venue: aStore.venue, node: aStore.node }, aId);
  const aKey = (await readNodeSigningKey(aStore.node, RING_A, aId))!;

  // Box B: joined to A through the real bundle A assembles.
  const bDir = await migratedFolder("waitron-copy-b-");
  const bState = await mkdtemp(join(tmpdir(), "waitron-copy-b-state-"));
  scratch.push(bState);
  const bStore = await openStore(bDir);
  let persisted: EncodedKeyRing | undefined;
  let bId: string | undefined;
  const joined = await adoptFromPrimary(
    {
      ownerDb: bStore.venue,
      ownerNode: bStore.node,
      ring: RING_B_OWN,
      advertisedOrigin: "https://spare.test",
      environment: "preproduction",
      database: "spare",
      stateDir: bState,
      persistTrading: async (args) => {
        bId = args.nodeId;
      },
      persistModuleConfig: async () => {},
      persistCredentialsRing: async (ring) => {
        persisted = ring;
      },
      fetchBundle: async (_url, _credential, standby) =>
        assembleMirrorBundle({
          appDb: aStore.venue,
          node: aStore.node,
          ring: RING_A,
          stateDir: aState,
          relayUrl: "https://relay.test",
          boxHostname: "waitron.local",
          accountKey: "test-account-key",
          designated: { nodeId: aId, locationId: loc!.id },
          standby,
        }),
    },
    { primaryUrl: "https://primary.test", credential: { personId: "p", password: "x" } },
    { beforeFirstWrite: async () => {} },
  );

  // A holds a chart it signed: A the main box, B a standby.
  copiedTerm = 3;
  const body = chartBody(copiedTerm, [
    { nodeId: aId, contactUrl: "https://primary.test", standing: "serving-primary" },
    { nodeId: bId!, contactUrl: "https://spare.test", standing: "serving-secondary" },
  ]);
  await writeNodeMembership(aStore.venue, {
    body,
    signerNodeId: aId,
    signature: signDocumentBody(body, aKey),
    endorsements: [],
  });

  await close(aStore);
  await close(bStore);
  a = { id: aId, publicKey: nodeSigningPublicKey(aKey), secret: aSecret, dir: aDir };
  b = {
    id: bId!,
    secret: joined.breakGlassSecret,
    dir: bDir,
    ring: loadKeyRing(keyRingEnv(persisted!)),
    nodeBytes: await readFile(join(bDir, NODE_FILE)),
  };
}, 120_000);

afterAll(async () => {
  for (const store of open.splice(0)) await store.close();
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A fresh copy of B's folder whose venue.db is replaced by A's, opened. */
async function bHoldingAsVenue(): Promise<Box> {
  const dir = await mkdtemp(join(tmpdir(), "waitron-copy-b-holds-a-"));
  scratch.push(dir);
  await cp(b.dir, dir, { recursive: true });
  for (const suffix of ["-wal", "-shm"]) await rm(join(dir, VENUE_FILE + suffix), { force: true });
  await cp(join(a.dir, VENUE_FILE), join(dir, VENUE_FILE));
  const store = await openStore(dir);
  return { dir, store, venue: store.venue, node: store.node, id: b.id };
}

function recordingLog() {
  const events: string[] = [];
  return {
    events,
    log: (_level: string, event: string) => {
      events.push(event);
    },
  };
}

describe("a spare whose venue.db is replaced by the main box's", () => {
  it("still reads its own role, signing key, recovery key and pinned main-box key", async () => {
    const box = await bHoldingAsVenue();

    expect(await readNodeMode(box.node, b.id)).toEqual({
      mode: "mirror",
      singletonRole: "secondary",
    });
    const holders = createDeploymentHolders("primary", "primary");
    await refreshDeploymentHolders(box.node, b.id, holders);
    // boot.ts's selling check (`acceptingSales`) needs a primary singleton outside mirror mode.
    expect(holders.mode.current).toBe("mirror");
    expect(holders.singletonRole.current).toBe("secondary");

    const bKey = await readNodeSigningKey(box.node, b.ring, b.id);
    expect(bKey).not.toBeNull();
    expect(nodeSigningPublicKey(bKey!)).not.toBe(a.publicKey);
    expect(await readNodeSigningKey(box.node, b.ring, a.id)).toBeNull();

    const verifier = (await readRecoveryKeyVerifier(box.node, b.id))!;
    expect(await verifySecretAsync(b.secret, verifier)).toBe(true);
    expect(await verifySecretAsync(a.secret, verifier)).toBe(false);

    expect(await readPinnedPrimaryKey(box.node, b.id)).toEqual({
      primaryNodeId: a.id,
      publicKey: a.publicKey,
    });

    await close(box.store);
    expect((await readFile(join(box.dir, NODE_FILE))).equals(b.nodeBytes)).toBe(true);
  });

  it("would have read a sole primary had it read the copied venue.db", async () => {
    const box = await bHoldingAsVenue();
    const fromCopy = await readNodeMode(box.venue as unknown as NodeDatabase, b.id);
    console.log("reading the copied venue.db decides", fromCopy);
    expect(fromCopy).toEqual({ mode: "primary", singletonRole: "primary" });
  });

  it("start-up's promotion repair leaves it a mirror on the copied chart", async () => {
    const box = await bHoldingAsVenue();
    expect((await readNodeMembership(box.venue))?.body.term).toBe(copiedTerm);
    const { events, log } = recordingLog();

    expect(
      await finishPromotedRole({
        venue: box.venue,
        node: box.node,
        ring: b.ring,
        nodeId: b.id,
        log,
      }),
    ).toBe("nothing");
    expect(await readNodeMode(box.node, b.id)).toEqual({
      mode: "mirror",
      singletonRole: "secondary",
    });
    expect(events).not.toContain("promotion.role_finished");
  });

  it.each<[NodeStanding, "finished" | "nothing", { mode: string; singletonRole: string }]>([
    ["serving-secondary", "nothing", { mode: "mirror", singletonRole: "secondary" }],
    ["sell-only", "nothing", { mode: "mirror", singletonRole: "secondary" }],
    ["serving-primary", "finished", { mode: "primary", singletonRole: "primary" }],
  ])(
    "a chart B signed naming itself %s, one term above the copy, gives %s",
    async (standing, outcome, axes) => {
      const box = await bHoldingAsVenue();
      const bKey = (await readNodeSigningKey(box.node, b.ring, b.id))!;
      const body = chartBody(copiedTerm + 1, [
        { nodeId: a.id, contactUrl: "https://primary.test", standing: "sell-only" },
        { nodeId: b.id, contactUrl: "https://spare.test", standing },
      ]);
      await writeNodeMembership(box.venue, {
        body,
        signerNodeId: b.id,
        signature: signDocumentBody(body, bKey),
        endorsements: [],
      });
      const { log } = recordingLog();

      expect(
        await finishPromotedRole({
          venue: box.venue,
          node: box.node,
          ring: b.ring,
          nodeId: b.id,
          log,
        }),
      ).toBe(outcome);
      expect(await readNodeMode(box.node, b.id)).toEqual(axes);
    },
  );

  // A known limit, with its own backlog entry: "a lost node.db beside an intact venue.db reads as a
  // sole primary".
  it("reads as a sole primary once its node.db is lost", async () => {
    const box = await bHoldingAsVenue();
    await close(box.store);
    for (const suffix of ["", "-wal", "-shm"])
      await rm(join(box.dir, NODE_FILE + suffix), { force: true });
    const reopened = await openStore(box.dir);

    expect(await readNodeMode(reopened.node, b.id)).toEqual({
      mode: "primary",
      singletonRole: "primary",
    });
    const holders = createDeploymentHolders("mirror", "secondary");
    await refreshDeploymentHolders(reopened.node, b.id, holders);
    expect(holders.mode.current).toBe("primary");
    expect(holders.singletonRole.current).toBe("primary");
  });
});
