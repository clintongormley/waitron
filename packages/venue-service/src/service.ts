import type { VenueServiceContribution } from "@waitron/module";
import {
  copyOrderServiceContext,
  copyWorkingLineContext,
  findOrderServiceContext,
  getOrderServiceContext,
  listServiceZones,
  listZoneOffers,
  listWorkingLineContexts,
  recordOrderServiceContext,
  retargetOrderServiceContext,
  recordWorkingLineContexts,
  resolvePreparationRoute,
  resolveNewOrderZone,
  resolveZoneOffer,
  resolveZoneContext,
} from "./operations.js";

/** The generic server-facing service seat; it owns no transaction and calls no server code. */
export const VENUE_SERVICE: VenueServiceContribution = {
  copyOrderContext: copyOrderServiceContext,
  copyLineContext: copyWorkingLineContext,
  findOrderContext: findOrderServiceContext,
  listLineContexts: listWorkingLineContexts,
  listServiceZones,
  resolveZoneContext,
  resolvePreparationRoute,
  listZoneOffers,
  resolveNewOrderZone,
  resolveZoneOffer,
  recordOrderContext: recordOrderServiceContext,
  retargetOrderContext: retargetOrderServiceContext,
  recordLineContexts: recordWorkingLineContexts,
  getOrderContext: getOrderServiceContext,
};
