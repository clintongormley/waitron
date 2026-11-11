import { AppError } from "@waitron/shared";
import "./errors.js";
import { readTenant, withTransaction, type Database } from "@waitron/db";
import { usableVenueName } from "../../../scripts/box/name-tag.mjs";
import type { BoxHostRequests, NameTag } from "./box-host-client.js";
import type { JobDefinition } from "./job-runner.js";

export function boxNameTagJob(deps: {
  db: Database;
  host: Pick<BoxHostRequests, "tagWrite">;
  live: () => boolean;
  wake?: () => void;
}): JobDefinition {
  const stop = deps.db.onCommit(() => deps.wake?.());
  let accepted: NameTag | undefined;
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
      const tag = name === null ? null : { name, live: deps.live() };
      const nextDueAt = new Date(now.getTime() + 60_000);
      if (
        accepted !== undefined &&
        (accepted === null
          ? tag === null
          : tag !== null && accepted.name === tag.name && accepted.live === tag.live)
      )
        return { nextDueAt };
      accepted = undefined;
      const answer = await deps.host.tagWrite(tag);
      if (!answer.available) {
        if (answer.reason === "missing" || answer.reason === "unsupported")
          return { nextDueAt: null, finished: true };
        throw new AppError("box_host.failed", {
          reason: "host_failed",
        });
      }
      accepted = tag;
      return { nextDueAt };
    },
  };
}
