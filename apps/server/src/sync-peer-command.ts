import { enrolPeer, listPeers, revokePeer } from "@waitron/sync";
import { type Database } from "@waitron/db";

type Env = Record<string, string | undefined>;

/** Open a pool, run `fn` against it, and always close it — the connect/try/finally each subcommand
 * otherwise repeats verbatim. Returns `fn`'s result (the process exit code). */
async function withDb<T>(
  connect: (url: string) => Promise<Database>,
  url: string,
  fn: (db: Database) => Promise<T>,
): Promise<T> {
  const db = await connect(url);
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

/**
 * The operator-run peer registry CLI (spec §7). A human runs this locally against the source node to
 * enrol a subscriber (minting its bearer token, printed ONCE), revoke one (instant — active := false),
 * or list them. Connects as the sync_retention member (WAITRON_SYNC_RETENTION_DATABASE_URL), the role
 * waitron-sync-evict uses. The evictSubscriberCommand shape: pure deps for the process wrapper to fill.
 */
export async function syncPeerCommand(deps: {
  argv: string[];
  env: Env;
  connect: (url: string) => Promise<Database>;
  out: (line: string) => void;
}): Promise<number> {
  const url = deps.env.WAITRON_SYNC_RETENTION_DATABASE_URL;
  if (url === undefined || url.length === 0) {
    deps.out("WAITRON_SYNC_RETENTION_DATABASE_URL is not set");
    return 2;
  }
  const [cmd, ...rest] = deps.argv;

  if (cmd === "enrol") {
    const subscriberId = rest[0];
    const name = rest.slice(1).join(" ");
    if (subscriberId === undefined || subscriberId.length === 0 || name.length === 0) {
      deps.out("usage: waitron-sync-peer enrol <subscriberId> <name>");
      return 2;
    }
    return withDb(deps.connect, url, async (db) => {
      const { peerId, token } = await enrolPeer(db, { subscriberId, name });
      deps.out(`enrolled peer ${peerId} for subscriber ${subscriberId}`);
      deps.out("token (shown once — copy it into the peer's WAITRON_SYNC_PEERS now):");
      deps.out(token);
      return 0;
    });
  }

  if (cmd === "revoke") {
    const peerId = rest[0];
    if (peerId === undefined || peerId.length === 0) {
      deps.out("usage: waitron-sync-peer revoke <peerId>");
      return 2;
    }
    return withDb(deps.connect, url, async (db) => {
      const { revoked } = await revokePeer(db, peerId);
      deps.out(revoked ? `revoked peer ${peerId}` : `no active peer ${peerId}`);
      return revoked ? 0 : 1;
    });
  }

  if (cmd === "list") {
    return withDb(deps.connect, url, async (db) => {
      const peers = await listPeers(db);
      if (peers.length === 0) {
        deps.out("no peers enrolled");
        return 0;
      }
      for (const p of peers) {
        deps.out(
          `${p.peerId}  ${p.subscriberId}  ${p.active ? "active" : "revoked"}  ` +
            `last-seen ${p.lastSeenAt ?? "never"}  ${p.name}`,
        );
      }
      return 0;
    });
  }

  deps.out("usage: waitron-sync-peer <enrol <subscriberId> <name> | revoke <peerId> | list>");
  return 2;
}
