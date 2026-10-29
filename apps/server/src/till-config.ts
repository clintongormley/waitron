import type { Decimal, DeviceOrigin, Origin } from "@waitron/shared";
import type { NodeConfig } from "./node-config.js";

export type OrderFlow = "prepay" | "ticket_then_pay";

export interface TillAppSettings {
  /** `WAITRON_TILL_LOCALE`, defaulted. Not the receipt's language. */
  locale: string;
  invoiceLocales: string[];
  /**
   * The RAW `WAITRON_TILL_LOCALE` (`undefined` when unset or empty), for the venue's default UI locale.
   * Distinct from the defaulted `locale`, which would mask the geography-based derivation.
   */
  localeOverride?: string;
  /** Whether the till offers a tip prompt at card collect. */
  tipsEnabled: boolean;
}

export interface TillConfig extends NodeConfig, TillAppSettings {
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

export function loadTillAppSettings(env: NodeJS.ProcessEnv): TillAppSettings {
  const rawLocale = env.WAITRON_TILL_LOCALE;
  const locale = rawLocale === undefined || rawLocale === "" ? "es-ES" : rawLocale;

  const rawTips = env.WAITRON_TILL_TIPS;
  const tipsEnabled = rawTips === "true" || rawTips === "1";

  return {
    locale,
    invoiceLocales: [locale],
    localeOverride: rawLocale === undefined || rawLocale === "" ? undefined : rawLocale,
    tipsEnabled,
  };
}
