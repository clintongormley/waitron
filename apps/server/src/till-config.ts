// Keeps this package's `errors.ts` augmentation reachable from every file that throws one of its
// codes — the reachability convention `config.ts` and `webhook.ts` follow (a side-effect import, no
// value used here). See the note atop `errors.ts`.
import "./errors.js";
import { AppError, locationId, nodeId, seriesId, tenantId, tillId } from "@waitron/shared";
import type { LocationId, NodeId, SeriesId, TenantId, TillId } from "@waitron/shared";

/**
 * The deployed till's identity, resolved once at boot from the environment provisioning stamped it
 * with. The four fiscal ids are branded (a bare uuid string cannot be passed where one of these is
 * expected), and `locationId` rides alongside because the sale path needs it: `recordTillSale`
 * (Task 3) and `GET /api/products` (Task 6) both call `listAvailableProducts(tx, locationId)`, so
 * the config the till carries has to include the location it sells from, not just its fiscal keys.
 *
 * `locale` / `invoiceLocales` are display-side: the till's own UI locale and the set of locales its
 * invoices are rendered in. One entry today (there is a single till locale), a list so the invoice
 * renderer never has to change shape when a second is added.
 */
export interface TillConfig {
  tenantId: TenantId;
  tillId: TillId;
  nodeId: NodeId;
  seriesId: SeriesId;
  locationId: LocationId;
  locale: string;
  invoiceLocales: string[];
}

/**
 * The value of `key`, or a loud failure. "Unset" is absent OR the empty string — an operator's
 * `VAR=` (as opposed to omitting the line) must be reported as missing, not accepted as a value that
 * will then fail the uuid check with a less honest code. Only the variable NAME travels in the
 * error, never the value.
 */
function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value === "") {
    throw new AppError("server.till_config_missing", { key });
  }
  return value;
}

/**
 * Runs a branded-id constructor over `raw`, translating its `shared.invalid_id` throw into
 * `server.till_config_invalid` naming the env var. The value that failed is deliberately dropped on
 * the floor here: the operator needs to know WHICH variable is malformed, and echoing a possibly-
 * secret value into an error is the leak `errors.ts` documents this code avoiding.
 */
function brand<T>(key: string, fn: (value: string) => T, raw: string): T {
  try {
    return fn(raw);
  } catch {
    throw new AppError("server.till_config_invalid", { key });
  }
}

/**
 * Resolve the till's fiscal identity (+ location and locale) from the environment, failing loudly on
 * any missing or malformed value. Every id is required and branded; `WAITRON_TILL_LOCALE` is the one
 * optional value, defaulting to `es-ES`.
 */
export function loadTillConfig(env: NodeJS.ProcessEnv): TillConfig {
  const locale = env.WAITRON_TILL_LOCALE ?? "es-ES";
  return {
    tenantId: brand("WAITRON_TILL_TENANT_ID", tenantId, required(env, "WAITRON_TILL_TENANT_ID")),
    tillId: brand("WAITRON_TILL_TILL_ID", tillId, required(env, "WAITRON_TILL_TILL_ID")),
    nodeId: brand("WAITRON_TILL_NODE_ID", nodeId, required(env, "WAITRON_TILL_NODE_ID")),
    seriesId: brand("WAITRON_TILL_SERIES_ID", seriesId, required(env, "WAITRON_TILL_SERIES_ID")),
    locationId: brand(
      "WAITRON_TILL_LOCATION_ID",
      locationId,
      required(env, "WAITRON_TILL_LOCATION_ID"),
    ),
    locale,
    invoiceLocales: [locale],
  };
}
