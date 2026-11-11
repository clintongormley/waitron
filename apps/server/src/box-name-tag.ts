import { readTenant, withTransaction, type Database } from "@waitron/db";
import { usableVenueName } from "../../../scripts/box/name-tag.mjs";
import type { BoxHostRequests } from "./box-host-client.js";
import type { JobDefinition } from "./job-runner.js";
import type { Logger } from "./logger.js";

export function boxNameTagJob(deps: {
  db: Database;
  host: Pick<BoxHostRequests, "tagWrite">;
  live: () => boolean;
  log: Logger;
  wake?: () => void;
}): JobDefinition {
  const stop = deps.db.onCommit(() => deps.wake?.());
  return {
    name: "box.name_tag",
    applies: () => true,
    minSleepMs: 0,
    maxSleepMs: 60_000,
    backoff: { firstMs: 5_000, maxMs: 60_000 },
    onStop: async () => {
      stop();
    },
    async pass({ now }) {
      const tenant = await withTransaction(deps.db, readTenant);
      const name = tenant === null ? null : usableVenueName(tenant.legalName);
      const answer = await deps.host.tagWrite(name === null ? null : { name, live: deps.live() });
      if (!answer.available) {
        if (answer.reason === "missing" || answer.reason === "unsupported")
          return { nextDueAt: null, finished: true };
        deps.log("warn", "box_host.tag_failed", { reason: answer.reason });
        return { nextDueAt: new Date(now.getTime() + 5_000), degraded: true };
      }
      return { nextDueAt: new Date(now.getTime() + 60_000) };
    },
  };
}
