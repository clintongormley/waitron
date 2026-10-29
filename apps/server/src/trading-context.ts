import type { Decimal, DeviceOrigin, Origin } from "@waitron/shared";
import type { NodeConfig } from "./node-config.js";
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
  extends NodeConfig, TillAppSettings, FiscalRuntimeContext, RequestEffects {
  /** Fiscal values and hashes must not depend on this flag. */
  practiceMode?: boolean;
}

export interface OriginConfig extends TradingContext {
  origin: Origin;
}

export interface DeviceRequestConfig extends TradingContext {
  origin: DeviceOrigin;
}
