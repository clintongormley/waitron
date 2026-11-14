import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { readPairSecret, type KeyRing } from "@waitron/credentials";
import { readNodeMembership, type Database, type NodeDatabase } from "@waitron/db";
import { routableServers, servingPrimaryNodeId } from "@waitron/membership";
import { readPairLink, readPinnedPrimaryKey } from "@waitron/node-db";
import { codeOf } from "@waitron/server-kit";
import { SPARE_FOLLOW_DIR, VENUE_FILE } from "@waitron/store";
import {
  createS3ObjectStore,
  followGeneration,
  parseGenerationName,
  type FollowArgs,
  type FollowProgress,
  type Follower,
  type ObjectStore,
  type SpawnFn,
} from "@waitron/stream";
import { askPeerStatus, readVenueAuthority, type AskPeerStatusDeps } from "./boot-peer-check.js";
import { peerKeyOf, signAsThisBox } from "./handover-signing.js";
import { boundObjectStore } from "./bounded-store.js";
import type { Logger } from "./logger.js";
import { readSpareGeneration } from "./spare-copy.js";
import { sleep } from "./spare-join.js";
import { spareStoreBucket, type SpareStore } from "./spare-store.js";

export interface SpareFollowView extends Omit<FollowProgress, "generation"> {
  generation: string | null;
  peerNodeId: string;
  clockAt: string | null;
}
export interface SpareFollowFacts {
  lagMs: number | null;
  phase: "upload" | "apply";
  clock: { boxAt: string; peerAt: string } | null;
}
export function readableFollow(value: unknown): value is FollowProgress & { clockAt?: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const txid = (x: unknown) => x === null || (typeof x === "string" && /^[0-9a-f]{16}$/.test(x));
  const date = (x: unknown) =>
    x === null ||
    (typeof x === "string" && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x);
  return (
    typeof v.generation === "string" &&
    parseGenerationName(v.generation) !== null &&
    typeof v.state === "string" &&
    ["rebuilding", "following", "unknown"].includes(v.state) &&
    txid(v.appliedTXID) &&
    txid(v.uploadedTXID) &&
    (v.lagMs === null ||
      (typeof v.lagMs === "number" && Number.isFinite(v.lagMs) && v.lagMs >= 0)) &&
    date(v.lastAppliedAt) &&
    (v.clockAt === undefined || (typeof v.clockAt === "string" && date(v.clockAt))) &&
    (v.state !== "following" ||
      (typeof v.appliedTXID === "string" &&
        typeof v.uploadedTXID === "string" &&
        v.appliedTXID <= v.uploadedTXID &&
        v.lagMs !== null))
  );
}
interface SpareFollowDeps {
  db: Database;
  node: NodeDatabase;
  ring: KeyRing;
  nodeId: string;
  stateDir: string;
  litestreamBin: string;
  mirror: boolean;
  store?: SpareStore;
  readRecoveryKey: () => Promise<string | undefined>;
  now: () => Date;
  log: Logger;
  readStream?: () => { state: string; generation?: string | null; lagMs?: number };
  lookup?: AskPeerStatusDeps["lookup"];
  intervalMs?: number;
  spawn?: SpawnFn;
  follow?: (args: FollowArgs) => Promise<Follower>;
  openStore?: typeof createS3ObjectStore;
  ask?: (peer: {
    nodeId: string;
    url: string;
    standing: import("@waitron/membership").NodeStanding;
  }) => Promise<{ follow?: unknown } | null>;
}

export function startSpareFollow(deps: SpareFollowDeps) {
  const stopping = new AbortController(),
    interval = deps.intervalMs ?? 5000;
  let stopped = false,
    follower: Follower | undefined,
    binding: string | undefined;
  let sourceStore:
    { key: string; bucket: ReturnType<typeof spareStoreBucket>; store: ObjectStore } | undefined;
  let local: FollowProgress | null = null,
    localAt = 0;
  let remote:
    | {
        binding: string;
        at: number;
        progress: FollowProgress;
        clockAt: string | null;
        observedAt: string;
      }
    | undefined;
  const folder = join(deps.stateDir, SPARE_FOLLOW_DIR);
  const clear = async () => {
    local = null;
    await follower?.stop();
    follower = undefined;
    binding = undefined;
  };
  async function context() {
    const link = await readPairLink(deps.node, deps.nodeId);
    const chart = await readNodeMembership(deps.db);
    const stream = deps.readStream?.();
    const key = JSON.stringify([link, chart?.signature, stream?.generation]);
    return { link, chart, stream, key };
  }
  async function pass() {
    const { link, chart, stream, key } = await context();
    if (deps.mirror) {
      if (
        link?.role !== "serves" ||
        deps.store === undefined ||
        chart === null ||
        servingPrimaryNodeId(chart) !== link.peerNodeId
      )
        return clear();
      const pin = await readPinnedPrimaryKey(deps.node, deps.nodeId);
      if (pin?.primaryNodeId !== link.peerNodeId) return clear();
      const storeKey = JSON.stringify(link);
      if (sourceStore?.key !== storeKey) {
        const bucket = spareStoreBucket(
          deps.store.loopbackUrl,
          link.accessKeyId,
          await readPairSecret(deps.node, deps.ring, deps.nodeId),
        );
        sourceStore = {
          key: storeKey,
          bucket,
          store: boundObjectStore((deps.openStore ?? createS3ObjectStore)(bucket), 5000),
        };
      }
      const { bucket, store } = sourceStore;
      const source = await readSpareGeneration(
        { link, pinnedKey: pin.publicKey, readRecoveryKey: deps.readRecoveryKey },
        store,
      );
      if (source.nodeId !== link.peerNodeId || source.term !== chart.body.term) return clear();
      const nextBinding = `${key}:${source.generation}:${source.streamKey}`;
      if (binding !== nextBinding) {
        await clear();
        await rm(folder, { recursive: true, force: true });
        await mkdir(folder, { recursive: true, mode: 0o700 });
        if (stopped) return;
        follower = await (deps.follow ?? followGeneration)({
          litestreamBin: deps.litestreamBin,
          bucket,
          streamKey: source.streamKey,
          generation: source.generation,
          outPath: join(folder, VENUE_FILE),
          now: deps.now,
          signal: stopping.signal,
          ...(deps.spawn === undefined ? {} : { spawn: deps.spawn }),
          store,
        });
        binding = nextBinding;
      }
      if (!stopped) {
        local = await follower!.read();
        localAt = performance.now();
        const exited = follower!.exit();
        if (exited !== null) {
          deps.log("warn", "spare.follow_exited", exited);
          await clear();
        }
      }
    } else {
      if (
        link?.role !== "streams" ||
        link.state !== "streaming" ||
        chart === null ||
        servingPrimaryNodeId(chart) !== deps.nodeId
      ) {
        remote = undefined;
        return;
      }
      if (remote?.binding !== key) remote = undefined;
      const peer = routableServers(chart).find((n) => n.nodeId === link.peerNodeId);
      if (peer === undefined) {
        remote = undefined;
        return;
      }
      const ask =
        deps.ask ??
        askPeerStatus({
          sign: (body) => signAsThisBox(deps, "query", body),
          publicKeyOf: await peerKeyOf(deps, chart),
          authorityOf: () => authority,
          lookup: deps.lookup,
          timeoutMs: 5000,
        });
      const answer = await ask(peer);
      const follow = answer?.follow;
      if (
        !readableFollow(follow) ||
        follow.generation !== stream?.generation ||
        parseGenerationName(follow.generation)?.term !== chart.body.term
      ) {
        remote = undefined;
        return;
      }
      remote = {
        binding: key,
        at: performance.now(),
        progress: follow,
        clockAt: follow.clockAt ?? null,
        observedAt: deps.now().toISOString(),
      };
    }
  }
  let authority: string | undefined;
  const running = (async () => {
    authority = await readVenueAuthority(deps.stateDir);
    while (!stopped) {
      try {
        await pass();
      } catch (error) {
        remote = undefined;
        await clear();
        if (!stopped) deps.log("info", "spare.follow_waiting", { errorCode: codeOf(error) });
      }
      await sleep(interval, stopping.signal);
    }
  })();
  async function reading() {
    const contextNow = await context();
    const cached =
      remote?.binding === contextNow.key && performance.now() - remote.at <= 2 * interval
        ? remote
        : undefined;
    return { ...contextNow, cached };
  }
  return {
    async facts(): Promise<SpareFollowFacts | null> {
      const { link, stream, cached } = await reading();
      if (link?.role !== "streams") return null;
      const apply = cached?.progress.lagMs ?? null;
      const upload = stream?.lagMs ?? 0;
      return {
        lagMs: apply === null ? null : Math.max(upload, apply),
        phase: apply !== null && apply >= upload ? "apply" : "upload",
        clock:
          cached?.clockAt == null ? null : { boxAt: cached.observedAt, peerAt: cached.clockAt },
      };
    },
    progress: () => (performance.now() - localAt <= 2 * interval ? local : null),
    async status(): Promise<SpareFollowView | null> {
      const { link, stream, cached } = await reading();
      if (link?.role !== "streams") return null;
      if (cached === undefined)
        return {
          peerNodeId: link.peerNodeId,
          state: "unknown",
          generation: stream?.generation ?? null,
          appliedTXID: null,
          uploadedTXID: null,
          lagMs: null,
          lastAppliedAt: null,
          clockAt: null,
        };
      const progress = cached.progress;
      return {
        ...progress,
        peerNodeId: link.peerNodeId,
        clockAt: cached.clockAt,
        lagMs: progress.lagMs === null ? null : Math.max(stream?.lagMs ?? 0, progress.lagMs),
      };
    },
    async stop() {
      stopped = true;
      stopping.abort();
      await running;
      await clear();
      remote = undefined;
    },
  };
}
