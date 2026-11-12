import type { TradingContext } from "../trading-context.js";

export type WithVenueRowId<C extends TradingContext = TradingContext> = C & {
  readonly locationId: string;
};
