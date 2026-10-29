// Side-effect import: keeps this package's `errors.ts` augmentation reachable from a file that
// throws its codes.
import "./errors.js";
import { eq } from "drizzle-orm";
import { AppError, locationId as brandLocationId, nodeId } from "@waitron/shared";
import type { Decimal, DeviceOrigin, LocationId, NodeId, Origin } from "@waitron/shared";
import { locations, nodes, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { isUnset } from "./env-value.js";

export type OrderFlow = "prepay" | "ticket_then_pay";

/** The node and its database-resolved location, with the till app settings. */
export interface TillConfig {
  nodeId: NodeId;
  locationId: LocationId;
  /** `WAITRON_TILL_LOCALE`, defaulted. Not the receipt's language. */
  locale: string;
  /** No product code reads it. */
  invoiceLocales: string[];
  /**
   * The RAW `WAITRON_TILL_LOCALE` (`undefined` when unset or empty), for the venue's default UI locale.
   * Distinct from the defaulted `locale`, which would mask the geography-based derivation.
   */
  localeOverride?: string;
  /** Whether the till offers a tip prompt at card collect. */
  tipsEnabled: boolean;
  /** Whether the installed fiscal contribution exposes an operation description field. */
  operationDescriptionRequired?: boolean;
  /** What a sale files when its department has no usable description: the fiscal seat's default. */
  operationDescriptionDefault?: string;
  /**
   * True for Demo and Prepare installations. Receipt renderers use it only to add an unmistakable
   * practice warning; fiscal values and hashes never depend on it.
   */
  practiceMode?: boolean;
  /** The device that sent this work to the kitchen, when the request has one. */
  sendingDeviceId?: string;
  /** Line ids of made-here records this request writes, for its till answer. */
  madeHereSink?: Set<string>;
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
export type TillIdentityConfig = Omit<TillConfig, "simplifiedInvoiceLimit" | "locationId">;

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
    nodeId: brand("WAITRON_NODE_ID", nodeId, required(env, "WAITRON_NODE_ID")),
    locale,
    invoiceLocales: [locale],
    localeOverride: rawLocale === undefined || rawLocale === "" ? undefined : rawLocale,
    tipsEnabled,
  };
}

export function tryLoadTillConfig(env: NodeJS.ProcessEnv): TillIdentityConfig | undefined {
  return isUnset(env.WAITRON_NODE_ID) ? undefined : loadTillConfig(env);
}

export async function readNodeLocation(
  db: Database | Transaction,
  id: NodeId,
): Promise<LocationId | null> {
  const [row] = await db
    .select({ locationId: locations.id })
    .from(nodes)
    .innerJoin(locations, eq(locations.id, nodes.locationId))
    .where(eq(nodes.id, id));
  return row === undefined ? null : brandLocationId(row.locationId);
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
