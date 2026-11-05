import type { TradingContext } from "../trading-context.js";

// The venue row's id, for filling `location_id` columns until the schema slices.
export type WithVenueRowId<C extends TradingContext = TradingContext> = C & {
  readonly locationId: string;
};
