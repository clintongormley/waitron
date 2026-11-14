import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { SPARE_FOLLOW_DIR, VENUE_FILE } from "@waitron/store";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  deletePairLinkTx,
  loadKeyRing,
  sealNodeSigningKeyTx,
  writePairLinkTx,
} from "@waitron/credentials";
import {
  CORE_MIGRATIONS,
  readNodeMembership,
  withNodeTransaction,
  writeNodeMembership,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { generateNodeKeyPair, signDocumentBody } from "@waitron/membership";
import { NODE_MIGRATIONS, pinPrimaryKeyTx } from "@waitron/node-db";
import {
  generationName,
  signPointer,
  type FollowArgs,
  type FollowProgress,
  type Follower,
} from "@waitron/stream";
import { createMemoryObjectStore } from "@waitron/stream/testing/memory-store.js";
import { startSpareFollow } from "./spare-follow.js";
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
const main = { nodeId: "main", ...generateNodeKeyPair() },
  spare = { nodeId: "spare", ...generateNodeKeyPair() };
const generation = generationName(1, main.nodeId, new Date("2026-11-14T12:00:00Z"));
const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, NODE_MIGRATIONS] });
let dir: string;
let running: ReturnType<typeof startSpareFollow> | undefined;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "waitron-spare-follow-"));
});
afterEach(async () => {
  await running?.stop();
  running = undefined;
  await rm(dir, { recursive: true, force: true });
});
const progress: FollowProgress = {
  generation,
  state: "following",
  appliedTXID: "0000000000000002",
  uploadedTXID: "0000000000000002",
  lagMs: 0,
  lastAppliedAt: "2026-11-14T12:01:00.000Z",
};
async function setup(role: "serves" | "streams") {
  const own = role === "serves" ? spare : main,
    peer = role === "serves" ? main : spare;
  await withNodeTransaction(suite.node, async (tx) => {
    await sealNodeSigningKeyTx(tx, ring, own.nodeId, own.privateKey);
    await writePairLinkTx(tx, ring, own.nodeId, {
      role,
      state: role === "serves" ? "copied" : "streaming",
      peerNodeId: peer.nodeId,
      peerPublicKey: peer.publicKey,
      storeUrl: "https://spare:7443",
      venueId: "venue-1",
      accessKeyId: "access",
      secretAccessKey: "secret",
    });
    await pinPrimaryKeyTx(tx, spare.nodeId, {
      primaryNodeId: main.nodeId,
      publicKey: main.publicKey,
    });
  });
  const body = {
    term: 1,
    nodes: [
      { nodeId: main.nodeId, contactUrl: "https://main", standing: "serving-primary" as const },
      { nodeId: spare.nodeId, contactUrl: "https://spare", standing: "serving-secondary" as const },
    ],
  };
  await writeNodeMembership(suite.db, {
    body,
    signerNodeId: main.nodeId,
    signature: signDocumentBody(body, main.privateKey),
    endorsements: [],
  });
  return {
    db: suite.db,
    node: suite.node,
    ring,
    nodeId: own.nodeId,
    stateDir: dir,
    litestreamBin: "litestream",
    now: () => new Date("2026-11-14T12:02:00Z"),
    readRecoveryKey: async () => "recovery-key-long-enough",
    log: vi.fn(),
    intervalMs: 5,
  };
}
describe("spare following", () => {
  it("follows only a pinned signed generation into scratch and stops before replacing it", async () => {
    const deps = await setup("serves");
    const store = createMemoryObjectStore();
    const events: string[] = [];
    let observation: FollowProgress["state"] = "following";
    let exited: { exitCode: number | null; category: string } | null = null;
    const follow = vi.fn(async (args: FollowArgs) => {
      events.push(`start ${args.generation}`);
      exited = null;
      return {
        exit: () => exited,
        read: async () => ({
          ...progress,
          generation: args.generation,
          state: observation,
          lagMs: observation === "unknown" ? null : 0,
        }),
        stop: async () => {
          events.push(`stop ${args.generation}`);
        },
      } satisfies Follower;
    });
    const pointer = async (gen: string, privateKey = main.privateKey) =>
      store.put(
        "current.json",
        new TextEncoder().encode(
          JSON.stringify(
            signPointer(
              {
                streamId: "venue-1",
                term: 1,
                nodeId: main.nodeId,
                generation: gen,
                writtenAt: "2026-11-14T12:00:00.000Z",
              },
              privateKey,
            ),
          ),
        ),
      );
    await pointer(generation, spare.privateKey);
    running = startSpareFollow({
      ...deps,
      mirror: true,
      store: { loopbackUrl: "http://127.0.0.1:9000", stop: async () => {} },
      openStore: () => store,
      follow,
    });
    await vi.waitFor(() => expect(deps.log).toHaveBeenCalled());
    expect(follow).not.toHaveBeenCalled();
    expect(running.progress()).toBeNull();
    await pointer(generation);
    await vi.waitFor(() => expect(running!.progress()).toEqual(progress));
    expect(follow.mock.calls[0]![0].outPath).toBe(join(dir, SPARE_FOLLOW_DIR, VENUE_FILE));
    observation = "unknown";
    await vi.waitFor(() => expect(running!.progress()?.state).toBe("unknown"));
    expect(events).toEqual([`start ${generation}`]);
    observation = "following";
    await vi.waitFor(() => expect(running!.progress()?.state).toBe("following"));
    const next = generationName(1, main.nodeId, new Date("2026-11-14T12:00:10Z"));
    await pointer(next);
    await vi.waitFor(() => expect(running!.progress()?.generation).toBe(next));
    expect(events.slice(0, 3)).toEqual([
      `start ${generation}`,
      `stop ${generation}`,
      `start ${next}`,
    ]);
    exited = { exitCode: 1, category: "bucket_refused" };
    await vi.waitFor(() =>
      expect(deps.log).toHaveBeenCalledWith("warn", "spare.follow_exited", {
        exitCode: 1,
        category: "bucket_refused",
      }),
    );
    await vi.waitFor(() => expect(follow).toHaveBeenCalledTimes(3));
    await pointer(next, spare.privateKey);
    await vi.waitFor(() => expect(running!.progress()).toBeNull());
    expect(events.at(-1)).toBe(`stop ${next}`);
  });
  it("keeps cached reads off the network and invalidates generation/chart changes or malformed progress", async () => {
    const deps = await setup("streams");
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    onTestFinished(() => clock.mockRestore());
    let stream = { state: "streaming" as const, generation, lagMs: 3200 };
    let answer: unknown = { ...progress, lagMs: 1000 };
    const ask = vi.fn(async () => ({ follow: answer }));
    running = startSpareFollow({ ...deps, mirror: false, readStream: () => stream, ask });
    await vi.waitFor(async () =>
      expect(await running!.status()).toMatchObject({ state: "following", lagMs: 3200 }),
    );
    expect(await running.facts()).toMatchObject({ lagMs: 3200, phase: "upload" });
    stream = { ...stream, lagMs: 0 };
    expect(await running.facts()).toMatchObject({ lagMs: 1000, phase: "apply" });
    const calls = ask.mock.calls.length;
    await running.status();
    await running.status();
    expect(ask).toHaveBeenCalledTimes(calls);
    stream = {
      ...stream,
      generation: generationName(1, main.nodeId, new Date("2026-11-14T12:00:10Z")),
    };
    expect(await running.status()).toMatchObject({ state: "unknown", lagMs: null });
    await vi.waitFor(() => expect(ask.mock.calls.length).toBeGreaterThan(calls));
    expect(await running.status()).toMatchObject({ state: "unknown", lagMs: null });
    stream = { ...stream, generation };
    answer = { ...progress, lagMs: -1 };
    const beforeMalformed = ask.mock.calls.length;
    await vi.waitFor(() => expect(ask.mock.calls.length).toBeGreaterThan(beforeMalformed));
    expect(await running.status()).toMatchObject({ state: "unknown" });
    answer = progress;
    await vi.waitFor(async () =>
      expect(await running!.status()).toMatchObject({ state: "following" }),
    );
    const held = (await readNodeMembership(suite.db))!;
    const body = { ...held.body, term: 2 };
    await writeNodeMembership(suite.db, {
      ...held,
      body,
      signature: signDocumentBody(body, main.privateKey),
    });
    expect(await running.status()).toMatchObject({ state: "unknown" });
    await withNodeTransaction(suite.node, (tx) => deletePairLinkTx(tx, main.nodeId));
    expect(await running.status()).toBeNull();
  });
  it("expires cached freshness while one signed ask remains pending", async () => {
    const deps = await setup("streams");
    let wall = new Date("2026-11-14T12:02:00.000Z");
    let now = 0,
      release!: (value: null) => void;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const pending = new Promise<null>((resolve) => {
      release = resolve;
    });
    const ask = vi
      .fn()
      .mockResolvedValueOnce({ follow: { ...progress, clockAt: "2026-11-14T12:00:20.000Z" } })
      .mockReturnValue(pending);
    try {
      running = startSpareFollow({
        ...deps,
        now: () => wall,
        mirror: false,
        readStream: () => ({ state: "streaming", generation, lagMs: 0 }),
        ask,
      });
      await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
      now = 10;
      wall = new Date("2026-11-14T12:03:00.000Z");
      expect((await running.facts())?.clock).toEqual({
        boxAt: "2026-11-14T12:02:00.000Z",
        peerAt: "2026-11-14T12:00:20.000Z",
      });
      expect(await running.status()).toMatchObject({ state: "following" });
      now = 11;
      expect((await running.facts())?.clock).toBeNull();
      expect(await running.status()).toMatchObject({ state: "unknown", lagMs: null });
      expect(ask).toHaveBeenCalledTimes(2);
    } finally {
      release(null);
      await running?.stop();
      clock.mockRestore();
    }
  });
});
