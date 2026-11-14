import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { followGeneration } from "./follow.js";
import { FakeLitestream } from "./testing/fake-litestream.js";
import { createMemoryObjectStore } from "./testing/memory-store.js";
import { verifyStreamKey } from "./sse-c.js";
vi.mock("./sse-c.js", () => ({ verifyStreamKey: vi.fn(async () => {}) }));
const bucket = {
  bucket: "copies",
  region: "us-east-1",
  prefix: "",
  accessKeyId: "key",
  secretAccessKey: "secret",
};
const generation = "gen-1-main-20261114T120000Z";
const paths: string[] = [];
afterEach(async () => {
  vi.mocked(verifyStreamKey).mockReset().mockResolvedValue();
  for (const p of paths.splice(0)) await rm(p, { recursive: true, force: true });
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "waitron-follow-"));
  paths.push(dir);
  const fake = new FakeLitestream();
  const store = createMemoryObjectStore({ now: () => new Date(1000) });
  let now = 2000,
    steady = 0;
  const args = {
    litestreamBin: "litestream",
    bucket,
    streamKey: Buffer.alloc(32, 9).toString("base64"),
    generation,
    outPath: join(dir, "venue.db"),
    store,
    now: () => new Date(now),
    monotonic: () => steady,
    spawn: fake.spawn,
  };
  return {
    args,
    fake,
    store,
    now: (value: number) => {
      now = value;
    },
    tick: (value: number) => {
      steady = value;
    },
  };
}
describe("followGeneration", () => {
  it("starts isolated native follow with keyed configuration, and reports applied position rather than uploads", async () => {
    const f = await fixture();
    const follower = await followGeneration(f.args);
    try {
      const child = f.fake.children[0]!;
      expect(child.args).toEqual([
        "restore",
        "-f",
        "-config",
        join(f.args.outPath + ".follow", "follow.yml"),
        "-o",
        f.args.outPath,
        join(f.args.outPath + ".follow", "venue.db"),
      ]);
      expect(await readFile(join(f.args.outPath + ".follow", "follow.yml"), "utf8")).toContain(
        "sse-customer-key:",
      );
      expect(child.env.WAITRON_STREAM_ENCRYPTION_KEY).toBe(f.args.streamKey);
      expect(verifyStreamKey).toHaveBeenCalledWith(bucket, generation, f.args.streamKey, undefined);
      await f.store.put(
        `${generation}/0000/0000000000000001-0000000000000002.ltx`,
        new Uint8Array([1]),
      );
      expect(await follower.read()).toMatchObject({
        state: "rebuilding",
        lagMs: null,
        appliedTXID: null,
      });
      await writeFile(`${f.args.outPath}-txid`, "0000000000000001\n");
      expect(await follower.read()).toMatchObject({
        state: "following",
        lagMs: 0,
        uploadedTXID: "0000000000000002",
        appliedTXID: "0000000000000001",
        lastAppliedAt: new Date(2000).toISOString(),
      });
      f.tick(1500);
      f.now(0);
      expect(await follower.read()).toMatchObject({
        lagMs: 1500,
        appliedTXID: "0000000000000001",
        uploadedTXID: "0000000000000002",
      });
      await writeFile(`${f.args.outPath}-txid`, "0000000000000002\n");
      f.now(9000);
      expect(await follower.read()).toMatchObject({ state: "following", lagMs: 0 });
      await f.store.delete(`${generation}/0000/0000000000000001-0000000000000002.ltx`);
      await f.store.put(
        `${generation}/0001/0000000000000001-0000000000000002.ltx`,
        new Uint8Array([2]),
      );
      f.now(90000);
      expect(await follower.read()).toMatchObject({
        lagMs: 0,
        lastAppliedAt: new Date(9000).toISOString(),
      });
      f.store.failNext({ operation: "list", error: new Error("offline") });
      expect(await follower.read()).toMatchObject({ state: "unknown", lagMs: null });
    } finally {
      await follower.stop();
    }
  });
  it("never reports an exited child or malformed sidecar as current and waits for stop", async () => {
    const f = await fixture();
    f.fake.replicateOutput = "AccessDenied private-provider-output";
    const follower = await followGeneration(f.args);
    await writeFile(`${f.args.outPath}-txid`, "broken");
    expect(await follower.read()).toMatchObject({ state: "unknown", lagMs: null });
    f.fake.children[0]!.exit(1);
    await Promise.resolve();
    expect(await follower.read()).toMatchObject({ state: "unknown", lagMs: null });
    expect(follower).toHaveProperty("exit", expect.any(Function));
    expect(follower.exit()).toEqual({ exitCode: 1, category: "bucket_refused" });
    await follower.stop();
    expect(await follower.read()).toMatchObject({ state: "unknown", lagMs: null });
  });
  it("starts no child when the existing stream-key check refuses", async () => {
    const f = await fixture();
    vi.mocked(verifyStreamKey).mockRejectedValueOnce(new Error("key refused"));
    await expect(followGeneration(f.args)).rejects.toThrow("key refused");
    expect(f.fake.children).toHaveLength(0);
  });
  it("does not resolve stop until the native child exit settles", async () => {
    const f = await fixture();
    let finish!: (code: number | null) => void;
    const exited = new Promise<number | null>((resolve) => {
      finish = resolve;
    });
    const follower = await followGeneration({
      ...f.args,
      spawn: () => ({ pid: undefined, exited, output: () => "", kill: () => {} }),
    });
    let settled = false;
    const stopping = follower.stop().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    finish(0);
    await stopping;
    expect(settled).toBe(true);
  });
  it("starts no late native child when stopped as key verification succeeds", async () => {
    const f = await fixture(),
      controller = new AbortController();
    vi.mocked(verifyStreamKey).mockImplementationOnce(async () => {
      controller.abort();
    });
    await expect(followGeneration({ ...f.args, signal: controller.signal })).rejects.toThrow();
    expect(f.fake.children).toHaveLength(0);
  });
  it("ages only still-unapplied positions during steady progress and a real stall", async () => {
    const f = await fixture(),
      follower = await followGeneration(f.args);
    const txid = (n: number) => n.toString(16).padStart(16, "0");
    try {
      for (let n = 1; n <= 15; n++) {
        f.tick(n * 5000);
        f.now(-n * 1000);
        await f.store.put(
          `${generation}/0000/${txid(n + 1)}-${txid(n + 1)}.ltx`,
          new Uint8Array([1]),
        );
        await writeFile(`${f.args.outPath}-txid`, txid(n));
        expect((await follower.read()).lagMs).toBe(0);
      }
      for (let n = 17; n <= 19; n++) {
        f.tick((n - 1) * 5000);
        await f.store.put(`${generation}/0000/${txid(n)}-${txid(n)}.ltx`, new Uint8Array([1]));
        expect((await follower.read()).lagMs).toBe((n - 16) * 5000);
      }
      f.tick(145000);
      expect((await follower.read()).lagMs).toBe(70000);
    } finally {
      await follower.stop();
    }
  });
});
