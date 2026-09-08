import type { Database, DeploymentMode } from "@waitron/db";
import {
  ensurePublications,
  listSubscriptions,
  publicationName,
  setSubscriptionPublications,
} from "@waitron/sync";
import type { DeploymentEnvironment } from "./config.js";
import type { Logger } from "./logger.js";

/**
 * The node's replication shape, reconciled on EVERY boot (swap spec §2.1/§4.2), idempotently:
 *
 *  1. Ensure both publications (`waitron_<env>_ledger` / `_state`) name exactly their derived tables —
 *     created absent, `ALTER … SET TABLE`ed on drift, left alone when exact. Runs in BOTH modes: a
 *     mirror creates them so a later promotion finds them ready, a primary keeps them current.
 *
 *  2. On a PRIMARY only (`mode !== "mirror"`), self-heal the promotion narrowing (spec §4.2 step 3):
 *     a node promoted while its subscription still named `[ledger, state]` must narrow that
 *     subscription to ledger-only so the drain window never re-copies configuration/state. The
 *     narrowing is `SET PUBLICATION … WITH (refresh = false)` (via `setSubscriptionPublications`) —
 *     a REFRESH would drop the state tables' un-applied WAL (probe C). A mirror is a pure subscriber
 *     and never narrows.
 *
 * `db` is the table-OWNER connection (the migrator owns every published table and every subscription
 * it created). The derived table lists come from `apps/server/src/modules.ts`.
 */
export async function ensureReplicationShape(
  db: Database,
  opts: {
    environment: DeploymentEnvironment;
    mode: DeploymentMode;
    ledgerTables: readonly string[];
    stateTables: readonly string[];
    log: Logger;
  },
): Promise<void> {
  const result = await ensurePublications(db, {
    environment: opts.environment,
    ledgerTables: opts.ledgerTables,
    stateTables: opts.stateTables,
  });
  opts.log("info", "replication.publications_ensured", {
    created: result.created,
    updated: result.updated,
  });

  if (opts.mode === "mirror") return;

  const statePub = publicationName(opts.environment, "state");
  const ledgerPub = publicationName(opts.environment, "ledger");
  const subs = await listSubscriptions(db);
  for (const sub of subs) {
    if (!sub.enabled || !sub.publications.includes(statePub)) continue;
    await setSubscriptionPublications(db, sub.name, [ledgerPub]);
    opts.log("info", "replication.subscription_narrowed", { subscription: sub.name });
  }
}
