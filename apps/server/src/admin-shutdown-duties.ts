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
import type { BackupSupervisor } from "./backup-supervisor.js";
import type { ServerConfig } from "./config.js";
import type { Logger } from "./logger.js";
import { recordShutdownPause } from "./stop-alert.js";
import type { JobRunner } from "./job-runner.js";
import { readStreamSettings } from "./stream-host.js";
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
  isMain(): boolean;
  now(): Date;
  workforceEnabled: boolean;
  log: Logger;
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
  let reportedPause: AbortSignal | undefined;
  const shutdown = createAdminShutdown({
    async check(signal) {
      if (!(await available())) throw new AppError("box.shutdown_unavailable", {});
      try {
        await backup.runForShutdown(signal, config.migrationsRoot);
      } catch (error) {
        // Retry reuses the shutdown's signal, so an alert covers the whole attempt.
        if (!signal.aborted && signal !== reportedPause) {
          await recordShutdownPause(db, codeOf(error), deps.now())
            .then(() => {
              reportedPause = signal;
              runner.wake("box.alert_mail");
            })
            .catch((failure: unknown) =>
              deps.log("warn", "server.shutdown_alert_failed", { errorCode: codeOf(failure) }),
            );
        }
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
    available,
    readStaff: () => (deps.workforceEnabled ? readShutdownStaff(db) : Promise.resolve([])),
    view: async () => ({ available: await available().catch(() => false), ...shutdown.status() }),
  };
}
