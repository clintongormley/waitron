import type { KeyRing } from "@waitron/credentials";
import { readNodeMembership, type Database, type NodeDatabase } from "@waitron/db";
import type { WaitronModule } from "@waitron/module";
import type { Context, Hono, MiddlewareHandler } from "hono";
import { closeListener } from "./close-listener.js";
import type { ServerConfig } from "./config.js";
import { mountHandoverPage } from "./handover-page-mount.js";
import { mountHandoverStatusApi } from "./handover-status-api.js";
import type { HealthState } from "./health.js";
import type { Logger } from "./logger.js";
import { startMdnsResponder, type MdnsSocket } from "./mdns.js";
import { mountNodeMembershipApi } from "./node-membership-api.js";
import { mountPeerStatusApi } from "./peer-status-api.js";
import { readBoxAddresses } from "./restricted-page.js";
import type { StartPeerCheckOutcome } from "./start-peer-check.js";
import {
  readNewerBucketMain,
  type BucketReplacement,
  type StartupBucketAnswer,
  type StreamHostDeps,
} from "./stream-host.js";
import { startWaiting, WAIT_RECHECK_MS } from "./waiting-start.js";

const INITIAL_BUCKET_ASK_MS = 5_000;
const BUCKET_WAIT_MS = 60_000;

interface WaitingDeps {
  db: Database;
  node: NodeDatabase;
  nodeId: string;
  ring: KeyRing;
  config: ServerConfig;
  log: Logger;
  now: () => Date;
  health: HealthState;
  modules: readonly WaitronModule[];
  cors: MiddlewareHandler;
  pageCheck: MiddlewareHandler;
  store?: StreamHostDeps["store"];
  intervalMs?: number;
  secure?: (c: Context) => boolean;
  mdnsSocket?: () => MdnsSocket;
  boxAddresses: () => string[];
  ownNameOnly: readonly string[];
  ownAndVenueNames: readonly string[];
  listenTrading: (app: Hono) => Parameters<typeof closeListener>[0];
  listenLanding: () => { close(): Promise<void> } | undefined;
  closeStore: () => Promise<void>;
  restart: () => void;
}

type Wait =
  | { kind: "shutdown"; clear: () => Promise<void> }
  | {
      kind: "peer";
      waitingOn: readonly string[];
      fenced: boolean;
      check: () => Promise<StartPeerCheckOutcome>;
    }
  | {
      kind: "bucket";
      deadline: AbortSignal;
      check: (signal: AbortSignal) => Promise<StartPeerCheckOutcome>;
    };

export function openStartupWait(deps: WaitingDeps, wait: Wait) {
  const { db, node, nodeId, ring, config, log } = deps;
  const fenced = wait.kind === "peer" && wait.fenced;
  return startWaiting({
    health: deps.health,
    now: deps.now,
    venueDir: config.venueDir,
    nodeId,
    environment: config.environment,
    readMembership: () => readNodeMembership(db),
    cors: deps.cors,
    pageCheck: deps.pageCheck,
    waitingOn: wait.kind === "peer" ? wait.waitingOn : [],
    addressesOf: (ids) => readBoxAddresses(db, ids),
    ...(wait.kind === "bucket"
      ? { bucketDeadline: wait.deadline }
      : {
          carryOn: {
            db,
            ...(wait.kind === "shutdown" ? { shutdown: wait.clear } : {}),
            credentialKeyRing: ring,
            modules: deps.modules,
            readNewerMain: () => readNewerBucketMain({ db, node, ring, nodeId, store: deps.store }),
            ...(deps.secure === undefined ? {} : { secure: deps.secure }),
            passkey: {
              rpId: config.managementRpId,
              managementOrigin: config.managementOrigin,
              nodeId,
            },
          },
        }),
    routes: [
      (app) => mountPeerStatusApi(app, { db, node, ring, nodeId }, log),
      (app) => {
        mountHandoverStatusApi(app, { db, node, ring, nodeId }, log);
        if (!fenced && config.setupAppDir !== undefined)
          mountHandoverPage(app, { root: config.setupAppDir, node, nodeId }, log);
      },
      (app, hooks) =>
        mountNodeMembershipApi(
          app,
          { db, node, nodeId, stepDown: hooks.stepDown, selling: () => !fenced },
          log,
        ),
    ],
    node,
    recheck: wait.kind === "shutdown" ? undefined : wait.check,
    intervalMs: deps.intervalMs ?? WAIT_RECHECK_MS,
    listen: (app, steppingDown) => {
      const server = deps.listenTrading(app);
      const mdns = startMdnsResponder({
        names: () => (steppingDown() ? deps.ownNameOnly : deps.ownAndVenueNames),
        makeSocket: deps.mdnsSocket,
        devMode: config.devMode,
        httpHost: config.httpHost,
        getAddresses: deps.boxAddresses,
        log,
      });
      const landing = deps.listenLanding();
      return {
        close: async () => {
          await mdns.stop().catch(() => {});
          await landing?.close().catch(() => {});
          await closeListener(server);
        },
      };
    },
    closeStore: deps.closeStore,
    restart: deps.restart,
    log,
  });
}

export async function waitForStartupBucket(
  deps: WaitingDeps,
  read: (signal: AbortSignal) => Promise<StartupBucketAnswer>,
  announceWaiting: (server: ReturnType<typeof startWaiting>["server"]) => void,
  waitMs = BUCKET_WAIT_MS,
) {
  const deadline = AbortSignal.timeout(waitMs);
  const first = await read(AbortSignal.any([deadline, AbortSignal.timeout(INITIAL_BUCKET_ASK_MS)]));
  if (first !== "silent" || deadline.aborted) return { answer: first };

  let replacement: BucketReplacement | undefined;
  const waiting = openStartupWait(deps, {
    kind: "bucket",
    deadline,
    check: async (signal) => {
      const answer = await read(signal);
      if (typeof answer !== "string") replacement = answer;
      return { result: answer === "silent" ? "wait" : "proceed", successorNodeId: null };
    },
  });
  announceWaiting(waiting.server);
  const end = await waiting.ended;
  if (end.kind === "stopped") return { stopped: waiting.server };
  return { answer: replacement ?? (end.kind === "timed-out" ? "silent" : "clear") } as const;
}
