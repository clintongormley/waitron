// Side-effect import: keeps this package's `errors.ts` augmentation reachable from a file that
// throws its codes.
import "./errors.js";
import { eq } from "drizzle-orm";
import { AppError, locationId, nodeId, seriesId, tillId } from "@waitron/shared";
import type { LocationId, NodeId, SeriesId, TillId } from "@waitron/shared";
import { locations, nodes, orderFlow, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { isUnset } from "./env-value.js";

/**
 * The per-venue pay-timing mode. It decides which issuance primitive fires and when, so a wrong
 * dispatch files the wrong kind of unrepairable fiscal record.
 */
export type OrderFlow = (typeof orderFlow.enumValues)[number];

/** The deployed till's identity, resolved once at boot from the environment provisioning stamped. */
export interface TillConfig {
  tillId: TillId;
  nodeId: NodeId;
  seriesId: SeriesId;
  locationId: LocationId;
  locale: string;
  invoiceLocales: string[];
  /**
   * The RAW `WAITRON_TILL_LOCALE` (`undefined` when unset or empty), for the venue's default UI locale.
   * Distinct from the defaulted `locale`, which would mask the geography-based derivation.
   */
  localeOverride?: string;
  /** Whether the till offers a tip prompt at card collect. */
  tipsEnabled: boolean;
  /**
   * True for Demo and Prepare installations. Receipt renderers use it only to add an unmistakable
   * practice warning; fiscal values and hashes never depend on it.
   */
  practiceMode?: boolean;
  /** Request-derived drawer eligibility; handheld cash sales never open a linked till's drawer. */
  allowCashDrawer?: boolean;
  /**
   * Read from the till's location row by `readOrderFlow`, not the environment — which is why
   * `loadTillConfig` returns `Omit<TillConfig, "orderFlow">`: no placeholder mode can reach a dispatch.
   */
  orderFlow: OrderFlow;
}

/** Only the variable NAME travels in the error, never the value. */
function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value === "") {
    throw new AppError("server.till_config_missing", { key });
  }
  return value;
}

/** The rejected value is deliberately not carried: it may be a secret pasted into the wrong variable. */
function brand<T>(key: string, fn: (value: string) => T, raw: string): T {
  try {
    return fn(raw);
  } catch {
    throw new AppError("server.till_config_invalid", { key });
  }
}

export function loadTillConfig(env: NodeJS.ProcessEnv): Omit<TillConfig, "orderFlow"> {
  const rawLocale = env.WAITRON_TILL_LOCALE;
  const locale = rawLocale === undefined || rawLocale === "" ? "es-ES" : rawLocale;

  const rawTips = env.WAITRON_TILL_TIPS;
  const tipsEnabled = rawTips === "true" || rawTips === "1";

  return {
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
    localeOverride: rawLocale === undefined || rawLocale === "" ? undefined : rawLocale,
    tipsEnabled,
  };
}

/** Order matters: a partial set names the FIRST missing variable in this order. */
const TILL_ID_VARS = [
  "WAITRON_TILL_TILL_ID",
  "WAITRON_TILL_NODE_ID",
  "WAITRON_TILL_SERIES_ID",
  "WAITRON_TILL_LOCATION_ID",
] as const;

/**
 * None of the four ids set is setup mode (`undefined`), not a fault. Some but not all set is a
 * misconfiguration, refused rather than silently degraded to setup mode.
 */
export function tryLoadTillConfig(
  env: NodeJS.ProcessEnv,
): Omit<TillConfig, "orderFlow"> | undefined {
  const present = TILL_ID_VARS.filter((v) => !isUnset(env[v]));
  if (present.length === 0) return undefined;
  if (present.length < TILL_ID_VARS.length) {
    const missing = TILL_ID_VARS.find((v) => isUnset(env[v]))!;
    throw new AppError("server.config_invalid", {
      variable: missing,
      reason: "till_config_partial",
    });
  }
  return loadTillConfig(env);
}

export async function readOrderFlow(
  db: Database,
  cfg: Pick<TillConfig, "locationId">,
): Promise<OrderFlow> {
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .select({ orderFlow: locations.orderFlow })
      .from(locations)
      .where(eq(locations.id, cfg.locationId));
    /* v8 ignore start */
    if (row === undefined) {
      throw new Error(`readOrderFlow: no location ${cfg.locationId}`);
    }
    /* v8 ignore stop */
    return row.orderFlow;
  });
}

/**
 * The node's stamped filing module, which `fiscalSlot` cross-checks against the enabled fiscal
 * module.
 */
export async function readFilingModule(
  db: Database,
  cfg: Pick<TillConfig, "nodeId">,
): Promise<string | null> {
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .select({ filingModule: nodes.filingModule })
      .from(nodes)
      .where(eq(nodes.id, cfg.nodeId));
    /* v8 ignore start */
    if (row === undefined) {
      throw new Error(`readFilingModule: no node ${cfg.nodeId}`);
    }
    /* v8 ignore stop */
    return row.filingModule;
  });
}
