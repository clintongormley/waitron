import { evictSubscriber } from "@waitron/sync";
import { type Database } from "@waitron/db";

type Env = Record<string, string | undefined>;

/**
 * The EXPLICIT, operator-run dead-subscriber eviction (spec §3.3/§3.4). A human runs this locally
 * against the node that holds the log — NEVER automatic, never peer-facing — after independently
 * confirming the subscriber is gone. Connects as an app_user member
 * (WAITRON_SYNC_RETENTION_DATABASE_URL) and DELETEs the subscriber's cursor rows so the next
 * retention sweep advances the log past it.
 */
export async function evictSubscriberCommand(deps: {
  argv: string[];
  env: Env;
  connect: (url: string) => Promise<Database>;
  out: (line: string) => void;
}): Promise<number> {
  const subscriberId = deps.argv[0];
  if (subscriberId === undefined || subscriberId.length === 0) {
    deps.out("usage: waitron-sync-evict <subscriberId>");
    return 2;
  }
  const url = deps.env.WAITRON_SYNC_RETENTION_DATABASE_URL;
  if (url === undefined || url.length === 0) {
    deps.out("WAITRON_SYNC_RETENTION_DATABASE_URL is not set");
    return 2;
  }
  const db = await deps.connect(url);
  try {
    const { deleted } = await evictSubscriber(db, subscriberId);
    deps.out(`evicted subscriber ${subscriberId}: released ${deleted} cursor row(s)`);
    return 0;
  } finally {
    await db.close();
  }
}
