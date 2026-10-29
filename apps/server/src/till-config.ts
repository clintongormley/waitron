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
