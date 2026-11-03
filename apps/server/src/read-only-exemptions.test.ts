import { cp, mkdtemp, rm } from "node:fs/promises";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  openVenueDatabase,
  stampDeployment,
  writeNodeMembership,
  type Database,
  type NodeDatabase,
  type VenueDatabase,
} from "@waitron/db";
import { seedNode, seedVenue } from "@waitron/db/testing/seed.js";
import { setNodeMode, setSingletonRole, writeMirrorLink } from "@waitron/node-db";
import type { SignedMembershipDocument } from "@waitron/membership";
import { loadKeyRing } from "@waitron/credentials";
import { applyMigrations, manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { ephemeralServerFixture } from "./testing/ephemeral-server-fixture.js";
import { freePort } from "./testing/free-ports.js";
import { establishNodeIdentity } from "./node-identity.js";
import { mintSelfSignedServerCert } from "./self-signed-cert.js";
import { READ_ONLY_EXEMPTIONS, isReadOnlyExempt } from "./read-only-exemptions.js";

vi.mock("@hono/node-server", async () => {
  const { ephemeralHttpMock } = await import("./testing/ephemeral-listener.js");
  return ephemeralHttpMock();
});

// No background dial reaches a real host; Node's global `fetch` still serves the probes.
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: vi.fn(() =>
      Promise.reject(new Error("undici fetch disabled in read-only-exemptions.test.ts")),
    ),
  };
});

const { startServer, httpPort } = ephemeralServerFixture();

describe("the read-only exemption list", () => {
  it("the exempt set is exactly this list", () => {
    expect(READ_ONLY_EXEMPTIONS.map(({ method, path, boxes }) => [method, path, boxes])).toEqual([
      ["POST", "/api/box/retire", ["fenced"]],
      ["POST", "/management-api/promote", ["mirror", "fenced"]],
      ["POST", "/management-api/promote/preparation", ["mirror", "fenced"]],
      ["POST", "/api/node/peer-status", ["mirror", "fenced"]],
      ["POST", "/api/node/membership", ["mirror", "fenced"]],
    ]);
    for (const row of READ_ONLY_EXEMPTIONS) expect(row.authenticates.trim()).not.toBe("");
  });

  it("exempts a row only on the boxes it names, and only for its method and exact path", () => {
    const mirror = { mirror: true, fenced: false };
    const fenced = { mirror: false, fenced: true };
    expect(isReadOnlyExempt({ method: "POST", path: "/api/box/retire" }, fenced)).toBe(true);
    expect(isReadOnlyExempt({ method: "POST", path: "/api/box/retire" }, mirror)).toBe(false);
    for (const box of [mirror, fenced]) {
      expect(isReadOnlyExempt({ method: "POST", path: "/api/node/peer-status" }, box)).toBe(true);
      expect(isReadOnlyExempt({ method: "PUT", path: "/api/node/peer-status" }, box)).toBe(false);
      expect(isReadOnlyExempt({ method: "POST", path: "/api/node/peer-status/x" }, box)).toBe(
        false,
      );
      expect(isReadOnlyExempt({ method: "POST", path: "/management-api/catalogues" }, box)).toBe(
        false,
      );
    }
    expect(
      isReadOnlyExempt(
        { method: "POST", path: "/management-api/promote" },
        { mirror: false, fenced: false },
      ),
    ).toBe(false);
  });
});

// Disables `fiscal-none` so a trading or mirror boot does not refuse `module.fiscal_slot_ambiguous`.
const STATE_ROOT = mkdtempSync(join(tmpdir(), "waitron-exemptions-state-"));
writeFileSync(
  join(STATE_ROOT, "modules.json"),
  JSON.stringify({ modules: { "fiscal-none": false } }),
);
const ORIGIN_NODE_ID = "77777777-7777-4777-8777-777777777777";
const KEY_ENV = {
  WAITRON_HTTP_LANDING_PORT: "0",
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 5).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
  WAITRON_STATE_DIR: STATE_ROOT,
  WAITRON_ENV: "preproduction",
  WAITRON_MIN_TICK_MS: "250",
  WAITRON_MAX_TICK_MS: "1000",
  WAITRON_SKIP_RETRY_MS: "250",
};

// The same credentials key boot loads, so the key sealed here is the one boot unseals.
const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: KEY_ENV.WAITRON_CREDENTIALS_KEY,
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

let migrationsRoot: string;
const openStores: VenueDatabase[] = [];
const venueDirs: string[] = [];
let mirror: { dir: string; nodeId: string };
let fenced: { dir: string; nodeId: string };

async function seededVenue(): Promise<[string, string, Database, NodeDatabase]> {
  const directory = await mkdtemp(join(tmpdir(), "waitron-exemptions-venue-"));
  venueDirs.push(directory);
  await applyMigrations(directory, migrationOptionsFor(manifestSets(), null));
  const store = await openVenueDatabase(directory);
  openStores.push(store);
  const db = store.venue;
  await seedVenue(db);
  const nodeId = await seedNode(db);
  await stampDeployment(db, "preproduction");
  // Every box holds its own node key; without one peer-status refuses before reading the query.
  await establishNodeIdentity({ ownerDb: db, node: store.node, ring: RING }, nodeId);
  return [directory, nodeId, db, store.node];
}

/** `readNodeMembership` does not verify the signature, so a placeholder is fine. */
function sellOnlyChart(nodeId: string): SignedMembershipDocument {
  return {
    body: { term: 5, nodes: [{ nodeId, contactUrl: "", standing: "sell-only" }] },
    signerNodeId: nodeId,
    signature: "self-placeholder-sig",
    endorsements: [],
  };
}

beforeAll(async () => {
  const fromSource = migrationOptionsFor(manifestSets(), null);
  migrationsRoot = await mkdtemp(join(tmpdir(), "waitron-exemptions-migrations-"));
  for (const [index, set] of manifestSets().entries()) {
    await cp(fromSource[index]!.migrationsFolder, join(migrationsRoot, set.name), {
      recursive: true,
    });
  }

  const [mDir, mId, mDb, mNode] = await seededVenue();
  mirror = { dir: mDir, nodeId: mId };
  await setNodeMode({ venue: mDb, node: mNode }, mId, "mirror");
  await writeMirrorLink(mNode, mId, {
    relayUrl: "http://127.0.0.1:1/",
    boxHostname: "mirror-box.local",
    boxCaPem: mintSelfSignedServerCert({
      hostnames: ["mirror-box.local"],
      ipAddresses: [],
      now: new Date(),
    }).caCertPem,
    originNodeId: ORIGIN_NODE_ID,
  });

  // A held chart marking this box sell-only: boot fences it and mounts the read-only gate.
  const [fDir, fId, fDb, fNode] = await seededVenue();
  fenced = { dir: fDir, nodeId: fId };
  await setSingletonRole({ venue: fDb, node: fNode }, fId, "primary");
  await writeNodeMembership(fDb, sellOnlyChart(fId));
}, 180_000);

afterAll(async () => {
  while (openStores.length > 0) await openStores.pop()?.close();
  for (const directory of [...venueDirs, migrationsRoot])
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  rmSync(STATE_ROOT, { recursive: true, force: true });
});

async function waitForFirstPass(server: { health: { lastPassAt: unknown } }): Promise<void> {
  for (let i = 0; i < 200 && server.health.lastPassAt == null; i += 1) await delay(50);
  expect(server.health.lastPassAt).not.toBeNull();
}

async function post(base: string, path: string): Promise<{ status: number; code: unknown }> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const body = (await response.json()) as { error?: { code?: unknown } };
  return { status: response.status, code: body.error?.code };
}

/** The membership route answers a body holding no chart with a bare refusal, not an error code. */
async function handEmptyChart(base: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${base}/api/node/membership`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  return { status: response.status, body: await response.json() };
}

const GATED = { status: 403, code: "node.read_only" };
// Preparation's own HTTPS check refuses a plain-HTTP call before it reads the body.
const PREPARATION_REFUSAL = { status: 403, code: "authorization.not_permitted" };

describe("each listed route is reached on a real read-only start, and nothing else is", () => {
  it("on a mirror", async () => {
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: mirror.dir,
      WAITRON_NODE_ID: mirror.nodeId,
      WAITRON_HTTP_PORT: String(await freePort()),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    });
    const base = `http://127.0.0.1:${httpPort()}`;
    try {
      await waitForFirstPass(server);
      expect({
        promote: await post(base, "/management-api/promote"),
        preparation: await post(base, "/management-api/promote/preparation"),
        peerStatus: await post(base, "/api/node/peer-status"),
        membership: await handEmptyChart(base),
        // Listed for a fenced box only.
        retire: await post(base, "/api/box/retire"),
        unlisted: await post(base, "/management-api/catalogues"),
      }).toEqual({
        promote: { status: 401, code: "password.invalid" },
        preparation: PREPARATION_REFUSAL,
        peerStatus: { status: 400, code: "handover.request_invalid" },
        membership: { status: 200, body: { accepted: false } },
        retire: GATED,
        unlisted: GATED,
      });
    } finally {
      await server.close();
    }
  }, 60_000);

  it("on a fenced box", async () => {
    const server = await startServer({
      ...KEY_ENV,
      WAITRON_VENUE_DIR: fenced.dir,
      WAITRON_NODE_ID: fenced.nodeId,
      WAITRON_HTTP_PORT: String(await freePort()),
      WAITRON_MIGRATIONS_DIR: migrationsRoot,
    });
    const base = `http://127.0.0.1:${httpPort()}`;
    try {
      await waitForFirstPass(server);
      expect({
        retire: await post(base, "/api/box/retire"),
        promote: await post(base, "/management-api/promote"),
        preparation: await post(base, "/management-api/promote/preparation"),
        peerStatus: await post(base, "/api/node/peer-status"),
        membership: await handEmptyChart(base),
        unlisted: await post(base, "/management-api/catalogues"),
      }).toEqual({
        retire: { status: 401, code: "management_session.required" },
        promote: { status: 401, code: "password.invalid" },
        preparation: PREPARATION_REFUSAL,
        peerStatus: { status: 400, code: "handover.request_invalid" },
        membership: { status: 200, body: { accepted: false } },
        unlisted: GATED,
      });
    } finally {
      await server.close();
    }
  }, 60_000);
});
