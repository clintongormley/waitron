import { setDeploymentMode, stampDeployment, writeMirrorConfig, type Database } from "@waitron/db";
import { adoptVenue } from "@waitron/provisioning";
import type { KeyRing } from "@waitron/credentials";
import { sealMirrorToken } from "./mirror-token.js";
import type { MirrorBundle } from "./mirror-bundle.js";
import type { TradingConfig } from "./trading-config.js";
import "./errors.js";

/** The setup-api `persistTrading` dep shape — an alias for `TradingConfig` (trading-config.ts), the
 * env the supervisor sources on the next boot so the mirror enters the trading branch (design §6). */
export type PersistTradingArgs = TradingConfig;

/** The admin login the operator supplies for the PRIMARY (design §8). It is the SAME shape the primary's
 * `POST /management-api/mirror-bundle` authenticates — the dashboard-login body (`mirror-bundle-api.ts`
 * screens exactly these fields) — carried as a structured object end to end so the whole chain
 * (connect screen → `/setup-api/adopt` → `fetchMirrorBundle` → the primary) is compile-time safe rather
 * than a JSON string threaded through an opaque `string`. `totp` is present only when the admin has TOTP
 * enrolled. It authorises the bundle mint on the primary; it never touches the mirror's own database. */
export interface AdoptCredential {
  personId: string;
  password: string;
  totp?: string;
}

/** The operator's two inputs (design §8): the primary's address and the admin login for it. */
export interface AdoptRequest {
  primaryUrl: string;
  credential: AdoptCredential;
}

export interface AdoptDeps {
  /** The OWNER connection to the mirror's database (`migrationsDatabaseUrl`) — inserts the tenant +
   * parent rows, stamps `deployment`, writes `mirror_config`, seals the token. `app_user` holds none
   * of those writes. */
  ownerDb: Database;
  /** The mirror's OWN vault key. The token is re-sealed under it (design §6); a value sealed with the
   * primary's key cannot be opened here. */
  ring: KeyRing;
  /** Fetches the bundle from the primary. Injected so the HTTP call (Task 9) is stubbable and the
   * orchestration is testable against a hand-built bundle. Throws `mirror.bundle_fetch_failed` on a
   * failed fetch — surfaced by the fetcher, not this orchestrator. */
  fetchBundle: (primaryUrl: string, credential: AdoptCredential) => Promise<MirrorBundle>;
  /** Persists `trading.env` so the next boot enters the trading branch (the setup-api dep, bound to
   * `writeTradingEnv` in boot). */
  persistTrading: (args: PersistTradingArgs) => Promise<void>;
  /** The app-pool connection string, written into `trading.env` as `DATABASE_URL`. */
  databaseUrl: string;
  /** The owner connection string, written into `trading.env` as `WAITRON_MIGRATIONS_DATABASE_URL`. */
  migrationsDatabaseUrl: string;
  /** The mirror's OWN sync-pool connection (a `sync_applier` LOGIN role), written into `trading.env`
   * as `WAITRON_SYNC_DATABASE_URL` — the value the next (mirror) boot's `loadMirrorSyncConfig` reads
   * back to enter mirror mode. Guaranteed non-empty by the boot adopt closure's Ruling 1 guard, which
   * refuses an unset value at adopt time (`server.config_missing`) rather than persist nothing. */
  syncDatabaseUrl: string;
}

/**
 * Adopt an existing venue into this mirror's own database (design §5), the mirror-side analogue of
 * `provisionVenue`. It fetches the primary's bundle, inserts the identity scaffold with the primary's
 * EXACT ids (never `registerSif` — `adoptVenue` guarantees that, so no second fiscal chain is forked,
 * CLAUDE.md §5), stamps the environment + `mirror` mode, seals the sync token in the mirror's OWN
 * vault, writes the DB-stored connection config, and persists `trading.env` for the restart.
 *
 * The order is load-bearing: `stampDeployment` runs BEFORE `setDeploymentMode`, which throws
 * `deployment.not_stamped` on an unstamped database (the `mode` UPDATE needs the singleton row). The
 * environment is stamped to the primary's value because it is immutable and must match the primary —
 * same venue, same chain (the one-database-per-environment invariant, CLAUDE.md §5). The token seal
 * runs after `adoptVenue` inserts the tenant (the vault FK is `restrict`).
 *
 * This function does NOT restart the box; the caller (the `/setup-api/adopt` endpoint) does that after
 * `trading.env` is persisted, the same persist-then-restart transition `provision` uses. A partial
 * failure mid-orchestration (a step throws after an earlier step committed) leaves the mirror
 * half-adopted; recovering from that is a deferred concern (spec §11 / the operator re-runs adopt,
 * which is idempotent for the row inserts via `ON CONFLICT DO NOTHING` and for the config via UPSERT).
 */
export async function adoptFromPrimary(
  deps: AdoptDeps,
  req: AdoptRequest,
): Promise<{ tenantId: string }> {
  const bundle = await deps.fetchBundle(req.primaryUrl, req.credential);
  const { designated, rows } = bundle;

  await stampDeployment(deps.ownerDb, bundle.environment);
  await adoptVenue(rows, designated, { db: deps.ownerDb });
  await setDeploymentMode(deps.ownerDb, "mirror");
  await sealMirrorToken(deps.ownerDb, deps.ring, designated.tenantId, bundle.syncToken);
  await writeMirrorConfig(deps.ownerDb, {
    relayUrl: bundle.relayUrl,
    boxHostname: bundle.boxHostname,
    boxCaPem: bundle.boxCaPem,
  });
  await deps.persistTrading({
    tenantId: designated.tenantId,
    locationId: designated.locationId,
    tillId: designated.tillId,
    nodeId: designated.nodeId,
    seriesId: designated.seriesId,
    databaseUrl: deps.databaseUrl,
    migrationsDatabaseUrl: deps.migrationsDatabaseUrl,
    syncDatabaseUrl: deps.syncDatabaseUrl,
    environment: bundle.environment,
  });

  return { tenantId: designated.tenantId };
}
