import { readNodeMembership, type Database, type NodeDatabase } from "@waitron/db";
import type { KeyRing } from "@waitron/credentials";
import { readPairLink } from "@waitron/node-db";
import { AppError } from "@waitron/shared";
import { createAdminShutdown } from "./admin-shutdown.js";
import { clearShutdownMark, writeShutdownMark } from "./admin-shutdown-hold.js";
import type { BackupSupervisor } from "./backup-supervisor.js";
import type { ServerConfig } from "./config.js";
import type { JobRunner } from "./job-runner.js";
import { readStreamSettings } from "./stream-host.js";
import { startTenderRefundResolvers, stopTenderRefundResolvers } from "./tender-refund-sends.js";
import "./errors.js";

export function adminShutdownDuties(deps: {
  db: Database;
  node: NodeDatabase;
  nodeId: string;
  ring: KeyRing;
  config: ServerConfig;
  runner: JobRunner;
  backup: BackupSupervisor;
  isMain(): boolean;
}) {
  const { backup, config, db, node, nodeId, ring, runner } = deps;
  const available = async () => {
    const status = backup.current();
    if (!deps.isMain() || !status.enabled || status.cloud || status.destinations.length !== 1)
      return false;
    const [membership, pair, stream] = await Promise.all([
      readNodeMembership(db),
      readPairLink(node, nodeId),
      readStreamSettings(db, ring),
    ]);
    return (
      pair === null &&
      stream === null &&
      !membership?.body.nodes.some((box) => box.nodeId !== nodeId && box.standing !== "evicted")
    );
  };
  const shutdown = createAdminShutdown({
    async check(signal) {
      if (!(await available())) throw new AppError("box.shutdown_unavailable", {});
      await backup.runForShutdown(signal, config.migrationsRoot);
    },
    save: () => writeShutdownMark(config.stateDir),
    clear: () => clearShutdownMark(config.stateDir),
    pauseDuties() {
      const pause = runner.pauseJobs();
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
    available,
    view: async () => ({ available: await available().catch(() => false), ...shutdown.status() }),
  };
}
