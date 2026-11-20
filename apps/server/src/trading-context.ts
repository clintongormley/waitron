import type { Decimal, DeviceOrigin, Origin, SaleOrigin } from "@waitron/shared";
import type { NodeIdentityConfig } from "./node-config.js";
import type { TillAppSettings } from "./till-config.js";

export interface FiscalRuntimeContext {
  simplifiedInvoiceLimit: Decimal | null;
  operationDescriptionRequired?: boolean;
  operationDescriptionDefault?: string;
}

export interface RequestEffects {
  sendingDeviceId?: string;
  madeHereSink?: Set<string>;
}

export interface TradingContext
  extends NodeIdentityConfig, TillAppSettings, FiscalRuntimeContext, RequestEffects {
  /** The venue's display language; receipts resolve their own language. */
  locale: string;
  /** Fiscal values and hashes must not depend on this flag. */
  practiceMode?: boolean;
  /** The start clock gate the fiscal seat holds on; a bill opened while it holds is stored with no
   * trusted opening time. Unset, bills open as if the time were confirmed; a live boot always
   * supplies it. */
  clockUnconfirmed?: () => boolean;
}

export interface OriginConfig extends TradingContext {
  origin: Origin;
}

export interface DeviceRequestConfig extends TradingContext {
  origin: DeviceOrigin;
}

export interface SaleOriginConfig extends TradingContext {
  origin: SaleOrigin;
}
