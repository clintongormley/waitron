import { activateDueMenuPublications } from "@waitron/menu";
import { withTransaction, type Database } from "@waitron/db";
import { codeOf } from "@waitron/server-kit";
import type { JobDefinition } from "./job-runner.js";
import type { Logger } from "./logger.js";
import { sleepMsFor } from "./loop.js";

const SCHEDULE = "menu_scheduled_publications";

export function menuActivationJob(deps: {
  db: Database;
  isPrimary: () => boolean;
  now: () => Date;
  log: Logger;
  maxWaitMs: number;
}): JobDefinition {
  return {
    name: "menu.activation",
    applies: deps.isPrimary,
    wakeOn: [SCHEDULE],
    minSleepMs: 0,
    maxSleepMs: deps.maxWaitMs,
    backoff: { firstMs: 5_000, maxMs: 300_000 },
    async pass({ now }) {
      try {
        const { activated, nextDueAt } = await withTransaction(deps.db, (tx) =>
          activateDueMenuPublications(tx, now),
        );
        for (const edition of activated) deps.log("info", "menu_publication.activated", edition);
        deps.log("debug", "menu_publication.activation_armed", {
          sleepMs: sleepMsFor(nextDueAt, deps.now(), 0, deps.maxWaitMs),
        });
        return { nextDueAt };
      } catch (error) {
        deps.log("warn", "menu_publication.activation_failed", { errorCode: codeOf(error) });
        throw error;
      }
    },
  };
}
