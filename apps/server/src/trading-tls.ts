import { mintedBoxLeaf } from "./box-secrets.js";
import type { TlsFiles } from "./tls.js";

export interface TradingTlsConfig {
  stateDir: string;
  tls?: TlsFiles;
}

/** Resolve the one TLS choice shared by the trading listener and its session cookies. */
export function resolveTradingTls(config: TradingTlsConfig): TlsFiles | undefined {
  return config.tls ?? mintedBoxLeaf(config.stateDir);
}
