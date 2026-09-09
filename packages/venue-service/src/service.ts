import type { VenueServiceContribution } from "@waitron/module";
import {
  findOrderServiceContext,
  getOrderServiceContext,
  listServiceZones,
  listZoneOffers,
  listWorkingLineContexts,
  recordOrderServiceContext,
  recordWorkingLineContexts,
  resolvePreparationRoute,
  resolveNewOrderZone,
  resolveZoneOffer,
  resolveZoneContext,
} from "./operations.js";

/** The generic server-facing service seat; it owns no transaction and calls no server code. */
export const VENUE_SERVICE: VenueServiceContribution = {
  findOrderContext: findOrderServiceContext,
  listLineContexts: listWorkingLineContexts,
  listServiceZones,
  resolveZoneContext,
  resolvePreparationRoute,
  listZoneOffers,
  resolveNewOrderZone,
  resolveZoneOffer,
  recordOrderContext: recordOrderServiceContext,
  recordLineContexts: recordWorkingLineContexts,
  getOrderContext: getOrderServiceContext,
};
