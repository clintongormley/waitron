import { readNodeMembership, withTransaction, type Database, type NodeDatabase } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import { persons } from "@waitron/identity";
import { eq, exists } from "drizzle-orm";
import { readLatestLiveEntry, timeEntries } from "@waitron/workforce";
import { readPairLink } from "@waitron/node-db";
import { codeOf } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { createAdminShutdown } from "./admin-shutdown.js";
import { clearShutdownMark, writeShutdownMark } from "./admin-shutdown-hold.js";
import { readArchiveSettingsWithMeta } from "./archive-settings.js";
import { loadBackupKey } from "./backup-config.js";
import type { BackupSupervisor } from "./backup-supervisor.js";
import type { ServerConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { recordShutdownPause } from "./stop-alert.js";
import type { JobRunner } from "./job-runner.js";
import { readStreamSettings, type StreamHost } from "./stream-host.js";
import type { SpareFollowView } from "./spare-follow.js";
import { startTenderRefundResolvers, stopTenderRefundResolvers } from "./tender-refund-sends.js";
import "./errors.js";

export async function readShutdownStaff(db: Database) {
  return withTransaction(db, async (tx) => {
    const hasEntries = tx
      .select({ id: timeEntries.id })
      .from(timeEntries)
      .where(eq(timeEntries.personId, persons.id));
    const people = await tx
      .select({ personId: persons.id, displayName: persons.displayName })
      .from(persons)
      .where(exists(hasEntries))
      .orderBy(persons.displayName);
    const staff = [];
    for (const { personId, displayName } of people) {
      const latest = await readLatestLiveEntry(tx, personId);
      if (latest?.entryKind === "in" || latest?.entryKind === "break_end")
        staff.push({ displayName, state: "working" as const });
      if (latest?.entryKind === "break_start")
        staff.push({ displayName, state: "on_break" as const });
    }
    return staff;
  });
}

export function adminShutdownDuties(deps: {
  db: Database;
  node: NodeDatabase;
  nodeId: string;
  ring: KeyRing;
  config: ServerConfig;
  runner: JobRunner;
  backup: BackupSupervisor;
  streamHost: StreamHost;
  readSpare(): Promise<SpareFollowView | null>;
  readBoxEnv(): Promise<Record<string, string | undefined>>;
  isMain(): boolean;
  now(): Date;
  workforceEnabled: boolean;
  log: Logger;
}) {
  const { backup, config, db, node, nodeId, ring, runner } = deps;
  const destination = async () => {
    const status = backup.current();
    if (!deps.isMain() || status.cloud) return undefined;
    const [membership, pair, stream] = await Promise.all([
      readNodeMembership(db),
      readPairLink(node, nodeId),
      readStreamSettings(db, ring),
    ]);
    const peers =
      membership?.body.nodes.filter((box) => box.nodeId !== nodeId && box.standing !== "evicted") ??
      [];
    let peerNodeId: string | undefined;
    if (pair !== null || peers.length > 0) {
      if (stream !== null) return undefined;
      const peer = peers.length === 1 ? peers[0] : undefined;
      if (
        pair?.role !== "streams" ||
        pair.state !== "streaming" ||
        peer?.standing !== "serving-secondary" ||
        peer.nodeId !== pair.peerNodeId
      )
        return undefined;
      const spare = await deps.readSpare();
      if (spare?.peerNodeId !== peer.nodeId || spare.state === "unknown") return undefined;
      peerNodeId = peer.nodeId;
    }
    const mode =
      peerNodeId !== undefined
        ? { paired: true as const }
        : stream !== null
          ? { directBucket: true as const }
          : {};
    if (status.enabled && status.destinations.length > 0)
      return { target: "saved" as const, peerNodeId, stream, mode };
    const { meta, settings } = await readArchiveSettingsWithMeta(db, ring);
    if (meta !== null || settings !== null) return undefined;
    const key = loadBackupKey(await deps.readBoxEnv());
    return key === undefined
      ? undefined
      : { target: key, peerNodeId, stream, mode: { ...mode, downloadOnly: true as const } };
  };
  let reportedPause: { signal: AbortSignal; pending: Promise<void> } | undefined;
  function reportPause(errorCode: string | null, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    if (reportedPause?.signal !== signal) {
      const pending = recordShutdownPause(db, errorCode, deps.now())
        .then(() => runner.wake("box.alert_mail"))
        .catch((failure: unknown) => {
          if (reportedPause?.signal === signal) reportedPause = undefined;
          deps.log("warn", "server.shutdown_alert_failed", { errorCode: codeOf(failure) });
        });
      reportedPause = { signal, pending };
    }
    return reportedPause.pending;
  }
  const shutdown = createAdminShutdown({
    async check(signal, { attemptSignal, waitForUpload }) {
      const dest = await destination();
      if (dest === undefined) throw new AppError("box.shutdown_unavailable", {});
      const { target, peerNodeId, stream } = dest;
      const confirmReplica =
        stream !== null
          ? (signal: AbortSignal) => deps.streamHost.checkDirectShutdownUpload(stream, signal)
          : peerNodeId !== undefined
            ? (signal: AbortSignal) => deps.streamHost.checkShutdownUpload(peerNodeId, signal)
            : undefined;
      try {
        let archive;
        if (target === "saved") {
          await backup.runForShutdown(signal, config.migrationsRoot, async (uploadSignal) => {
            const waiting = waitForUpload(uploadSignal);
            const reporting = reportPause(null, attemptSignal);
            await waiting.finally(() => reporting);
          });
        } else archive = await backup.runForShutdownDownload(signal, target, config.migrationsRoot);
        return {
          archive,
          checkReplica:
            confirmReplica === undefined
              ? undefined
              : async (activeSignal) => {
                  try {
                    if (!(await confirmReplica(activeSignal)))
                      throw new AppError(
                        stream === null
                          ? "box.shutdown_spare_unchecked"
                          : "box.shutdown_bucket_unchecked",
                        {},
                      );
                  } catch (error) {
                    if (!activeSignal.aborted) await reportPause(codeOf(error), attemptSignal);
                    throw error;
                  }
                },
        };
      } catch (error) {
        if (!signal.aborted) await reportPause(codeOf(error), attemptSignal);
        throw error;
      }
    },
    save: () => writeShutdownMark(config.stateDir),
    clear: () => clearShutdownMark(config.stateDir),
    pauseDuties() {
      // Alert delivery may continue while the backup holds the rest of the venue's writers.
      const pause = runner.pauseJobs(["box.alert_mail", "mail.send"]);
      return {
        settled: pause.settled,
        drainRefunds: () => stopTenderRefundResolvers(db),
        resume() {
          startTenderRefundResolvers(db);
          pause.resume();
        },
      };
    },
  });
  return {
    ...shutdown,
    async start() {
      const dest = await destination();
      if (dest === undefined) throw new AppError("box.shutdown_unavailable", {});
      shutdown.start(dest.mode);
    },
    available: async () => (await destination()) !== undefined,
    readStaff: () => (deps.workforceEnabled ? readShutdownStaff(db) : Promise.resolve([])),
    view: async () => {
      const dest = await destination().catch(() => undefined);
      const status = shutdown.view();
      return {
        available: dest !== undefined,
        ...(status.phase === "idle" ? dest?.mode : undefined),
        ...status,
      };
    },
  };
}
