import type { TradingContext } from "../trading-context.js";

// Node, Cloud and backup fixtures still need the venue row until their ID consumers move.
export type WithVenueRowId<C extends TradingContext = TradingContext> = C & {
  readonly locationId: string;
};
