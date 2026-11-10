export type OrderFlow = "prepay" | "ticket_then_pay";

export interface TillAppSettings {
  /** Whether the till offers a tip prompt at card collect. */
  tipsEnabled: boolean;
}

export function loadTillAppSettings(env: NodeJS.ProcessEnv): TillAppSettings {
  const rawTips = env.WAITRON_TILL_TIPS;
  return { tipsEnabled: rawTips === "true" || rawTips === "1" };
}
