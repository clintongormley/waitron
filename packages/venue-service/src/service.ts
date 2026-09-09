import type { VenueServiceContribution } from "@waitron/module";
import {
  getOrderServiceContext,
  listZoneOffers,
  recordOrderServiceContext,
  resolvePreparationRoute,
  resolveZoneContext,
} from "./operations.js";

/** The generic server-facing service seat; it owns no transaction and calls no server code. */
export const VENUE_SERVICE: VenueServiceContribution = {
  resolveZoneContext,
  resolvePreparationRoute,
  listZoneOffers,
  recordOrderContext: recordOrderServiceContext,
  getOrderContext: getOrderServiceContext,
};
