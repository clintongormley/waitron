import { setDeploymentMode, stampDeployment, writeMirrorConfig, type Database } from "@waitron/db";
import { adoptVenue, assertNoForeignObligado, readObligadoIdentities } from "@waitron/provisioning";
import type { KeyRing } from "@waitron/credentials";
import { enabledModules, parseModuleOverrides, type ModuleConfig } from "@waitron/module";
import { ALL_MODULES } from "./modules.js";
import { sealMirrorToken } from "./mirror-token.js";
import type { MirrorBundle } from "./mirror-bundle.js";
import { establishReservedStandbyIdentity, generateStandbyIdentity } from "./reserved-identity.js";
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
  /** Fetches the bundle from the primary, carrying the mirror's own `standby` identity so the primary
   * can reserve + endorse it (membership promotion R2). Injected so the HTTP call (Task 9) is stubbable
   * and the orchestration is testable against a hand-built bundle. Throws `mirror.bundle_fetch_failed`
   * on a failed fetch — surfaced by the fetcher, not this orchestrator. */
  fetchBundle: (
    primaryUrl: string,
    credential: AdoptCredential,
    standby: { nodeId: string; publicKey: string; contactUrl: string },
  ) => Promise<MirrorBundle>;
  /** This node's own advertised origin (`config.advertisedOrigin`), sent to the primary as the joining
   * node's `contactUrl`: the primary records it in the membership document so a till can route here
   * after a failover (till-reroute design §3.3). The ROUTE's contract accepts `""` (a node that
   * advertises nothing is still a member), but this node never sends one: `config.advertisedOrigin`
   * falls back to `managementOrigin`, and `bareOrigin` refuses `""`. */
  advertisedOrigin: string;
  /** Persists `trading.env` so the next boot enters the trading branch (the setup-api dep, bound to
   * `writeTradingEnv` in boot). */
  persistTrading: (args: PersistTradingArgs) => Promise<void>;
  /** Persists `<stateDir>/modules.json` so the mirror's next boot sees the primary's enabled set
   * (SP-1d) — drives reconcile-drift logging now, SP-2's per-module pull filter later. It does NOT
   * change what the mirror migrates: a fresh mirror already migrated every table in setup mode, so
   * the trading-boot filter is a no-op over an already-complete schema. Injected — bound to
   * `writeModuleConfig(config.stateDir, …)` in boot. */
  persistModuleConfig: (config: ModuleConfig) => Promise<void>;
  /** The app-pool connection string, written into `trading.env` as `DATABASE_URL`. */
  databaseUrl: string;
  /** The owner connection string, written into `trading.env` as `WAITRON_MIGRATIONS_DATABASE_URL`. */
  migrationsDatabaseUrl: string;
  /** The mirror's OWN sync-pool connection (a `sync_applier` LOGIN role), written into `trading.env`
   * as `WAITRON_SYNC_DATABASE_URL` — the value the next (mirror) boot's `loadMirrorSyncConfig` reads
   * back to enter mirror mode. Guaranteed non-empty by the boot adopt closure's Ruling 1 guard, which
   * refuses an unset value at adopt time (`server.config_missing`) rather than persist nothing. */
  syncDatabaseUrl: string;
  /** The NAME of the mirror's own database, echoed by `provisioning.foreign_obligado` when a bundle
   * for a DIFFERENT obligado is adopted into a database that already holds one (operator-typed
   * configuration, never a secret). Boot derives it from `config.migrationsDatabaseUrl`, the same
   * `ownerDatabaseName` the provision path passes to `provisionVenue`. */
  database: string;
}

/**
 * Adopt an existing venue into this mirror's own database (design §5), the mirror-side analogue of
 * `provisionVenue`. It mints the standby's identity in memory, fetches the primary's bundle (sending
 * that identity for reservation + endorsement), inserts the identity scaffold with the primary's EXACT
 * ids (never `registerSif` — `adoptVenue` guarantees that, so no second fiscal chain is forked,
 * CLAUDE.md §5), stamps the environment + `mirror` mode, establishes the standby's DORMANT identity from
 * the reserved bundle (design §6 R2), seals the sync token in the mirror's OWN vault, writes the
 * DB-stored connection config, persists the primary's enabled-module set to the mirror's own
 * `modules.json` (SP-1d, so the mirror's next boot sees the same set), and persists `trading.env` for
 * the restart.
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
  // Mint the standby's own identity in memory BEFORE the fetch (design §6 R2): its public half + nodeId
  // are sent to the primary, which reserves the standby's fiscal identity and endorses its key, returning
  // both in `bundle.reservedIdentity`. The private half stays local until it is sealed below. This
  // node's advertised origin rides along as the joining node's `contactUrl`, which the primary appends
  // to the membership document (till-reroute §3.3).
  const standby = generateStandbyIdentity();
  const bundle = await deps.fetchBundle(req.primaryUrl, req.credential, {
    nodeId: standby.nodeId,
    publicKey: standby.publicKey,
    contactUrl: deps.advertisedOrigin,
  });
  const { designated, rows } = bundle;

  // SP-1d: validate the primary's enabled-module set FIRST — fail fast, before any side effect. It is
  // a bare override map (bundle wire value, not a file envelope), so `parseModuleOverrides` takes it
  // directly (no fabricated `{ modules: … }` wrapper). Re-validated against THIS node's ALL_MODULES:
  // an unknown/malformed override from a skewed or hostile primary throws `module.config_*` here,
  // BEFORE stampDeployment/adoptVenue/token-seal mutate the mirror — never leaving a half-adopted DB
  // for a set we would have rejected. A well-behaved primary on the same monorepo build shares this
  // node's ALL_MODULES, so a valid bundle never trips this; it fires only for a skewed or hostile
  // primary — which is exactly why the mirror re-validates external input rather than trusting it
  // (CLAUDE.md §3). The validated config is persisted below (unconditionally, even {}), so the
  // mirror's set is explicitly the primary's and re-adopt is idempotent.
  const moduleConfig = parseModuleOverrides(bundle.moduleOverrides, ALL_MODULES);

  // Refuse a FOREIGN obligado before any mutation, the third caller of the shared one-obligado guard
  // (why it exists: `obligado-guard.ts`; the sibling callers: `provisionVenue`, the `venue` CLI). Runs
  // after the up-front module validation so both fail-closed checks precede `stampDeployment`.
  // `adoptVenue`'s `ON CONFLICT (id) DO NOTHING` makes re-inserting the SAME bundle's tenant row a
  // no-op, but does NOT stop a DIFFERENT obligado landing beside an incumbent — that is this guard's
  // job. The applied identity is the bundle tenant's `(country, tax_id)` as the primary stored it.
  assertNoForeignObligado(
    await readObligadoIdentities(deps.ownerDb),
    { country: rows.tenant.country as string, taxId: rows.tenant.taxId as string },
    deps.database,
  );

  await stampDeployment(deps.ownerDb, bundle.environment);
  await adoptVenue(rows, designated, { db: deps.ownerDb });
  await setDeploymentMode(deps.ownerDb, "mirror");
  // Establish the standby's DORMANT identity from the reserved bundle (design §6 R2), after the tenant +
  // parent rows exist (the vault + node/series FKs are restrict) and before the token seal. All inert:
  // the reserved SIF is keyed to the standby's OWN nodeId, which from R3a is ALSO `config.till.nodeId`
  // (the mirror runs under its own identity, persisted below). Inertness therefore rests on the box
  // being a READ-ONLY MIRROR — the read-only gate refuses every write, so no sale is ever recorded to
  // resolve it — NOT on an id mismatch; on an R3b promotion the mode flips and this same reserved SIF
  // is activated as the (now-primary) node's live chain. The
  // standby's node mirrors the primary's modules: read the primary's designated node row from the bundle
  // (camelCase `$inferInsert` rows, `Record<string, unknown>`) for its name + filing/tax modules.
  const primaryNode = bundle.rows.nodes.find((n) => n.id === designated.nodeId);
  await establishReservedStandbyIdentity(
    { ownerDb: deps.ownerDb, ring: deps.ring },
    {
      tenantId: designated.tenantId,
      locationId: designated.locationId,
      standby,
      nodeName: `${(primaryNode?.name as string) ?? "venue"} (standby)`,
      filingModule: (primaryNode?.filingModule as string | null) ?? null,
      taxModule: (primaryNode?.taxModule as string | null) ?? null,
      modules: enabledModules(ALL_MODULES, moduleConfig),
      reserved: bundle.reservedIdentity,
    },
  );
  await sealMirrorToken(deps.ownerDb, deps.ring, designated.tenantId, bundle.syncToken);
  // The mirror's connection config, plus its sync ORIGIN — the PRIMARY's node id (`designated.nodeId`)
  // (membership promotion R3a). The mirror now runs under its OWN identity (`nodeId` below is the
  // standby's own), so the node whose replicated rows it pulls can no longer be read off
  // `config.till.nodeId`; it is persisted here and read back at boot to drive the pull peer's origin
  // and the mirror's node-scoped read paths (report-api).
  await writeMirrorConfig(deps.ownerDb, {
    relayUrl: bundle.relayUrl,
    boxHostname: bundle.boxHostname,
    boxCaPem: bundle.boxCaPem,
    originNodeId: designated.nodeId,
  });
  // SP-1d: persist the module set validated up-front (above) into the mirror's own modules.json, so its
  // next boot sees the primary's enabled set. Ordered before `persistTrading` for the same fail-closed
  // reason the whole sequence honours — but the throwing check already ran before any DB write.
  await deps.persistModuleConfig(moduleConfig);
  await deps.persistTrading({
    tenantId: designated.tenantId,
    locationId: designated.locationId,
    tillId: designated.tillId,
    // The mirror's OWN node id (the standby minted in memory above), NOT `designated.nodeId` — from
    // R3a `config.till.nodeId` is the mirror's own identity (the subscriber it pulls as, the origin it
    // stamps its own writes with once promoted). `tenantId`/`locationId`/`tillId` stay the shared
    // venue's `designated.*`; `seriesId` stays `designated.*` here (inert on a read-only mirror) and is
    // corrected to the cloud's own reserved series at R3b.
    nodeId: standby.nodeId,
    seriesId: designated.seriesId,
    databaseUrl: deps.databaseUrl,
    migrationsDatabaseUrl: deps.migrationsDatabaseUrl,
    syncDatabaseUrl: deps.syncDatabaseUrl,
    environment: bundle.environment,
  });

  return { tenantId: designated.tenantId };
}
