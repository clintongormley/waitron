// Side-effect import: keeps this package's `errors.ts` augmentation reachable from a file that
// throws its codes.
import "./errors.js";
import { eq } from "drizzle-orm";
import { AppError, locationId, nodeId, seriesId } from "@waitron/shared";
import type { Decimal, DeviceOrigin, LocationId, NodeId, Origin, SeriesId } from "@waitron/shared";
import { nodes, orderFlow, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { isUnset } from "./env-value.js";

/**
 * A pay-timing mode. It decides which issuance primitive fires and when, so a wrong
 * dispatch files the wrong kind of unrepairable fiscal record.
 */
export type OrderFlow = (typeof orderFlow.enumValues)[number];

/** The venue's identity on this node, resolved once at boot from the environment provisioning
 * stamped. */
export interface TillConfig {
  nodeId: NodeId;
  seriesId: SeriesId;
  locationId: LocationId;
  /**
   * `WAITRON_TILL_LOCALE`, defaulted. Not the receipt's language: a sale is filed and printed in its
   * location's saved language (`readReceiptLanguage`).
   */
  locale: string;
  /** No product code reads it; a sale files its location's saved list. */
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
  /** The device that sent this work to the kitchen, when the request has one. */
  sendingDeviceId?: string;
  /** Line ids of made-here records this request writes, for its till answer. */
  madeHereSink?: Set<string>;
  orderFlow: OrderFlow;
  /**
   * The largest total this regime records for a sale with no named customer, from the fiscal
   * backend's `simplifiedInvoiceLimit` at boot, or null when the regime sets none.
   */
  simplifiedInvoiceLimit: Decimal | null;
}

/** A configuration that says where the records it writes came from. */
export interface OriginConfig extends TillConfig {
  origin: Origin;
}

/** A till-app request's configuration: its records come from the request's device. */
export interface DeviceRequestConfig extends TillConfig {
  origin: DeviceOrigin;
}

/** What the environment alone says about the venue's identity on this node: boot adds the rest
 * from the database and the fiscal backend. */
export type TillIdentityConfig = Omit<TillConfig, "orderFlow" | "simplifiedInvoiceLimit">;

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

export function loadTillConfig(env: NodeJS.ProcessEnv): TillIdentityConfig {
  const rawLocale = env.WAITRON_TILL_LOCALE;
  const locale = rawLocale === undefined || rawLocale === "" ? "es-ES" : rawLocale;

  const rawTips = env.WAITRON_TILL_TIPS;
  const tipsEnabled = rawTips === "true" || rawTips === "1";

  return {
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
  "WAITRON_TILL_NODE_ID",
  "WAITRON_TILL_SERIES_ID",
  "WAITRON_TILL_LOCATION_ID",
] as const;

/**
 * None of the three ids set is setup mode (`undefined`), not a fault. Some but not all set is a
 * misconfiguration, refused rather than silently degraded to setup mode.
 */
export function tryLoadTillConfig(env: NodeJS.ProcessEnv): TillIdentityConfig | undefined {
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
