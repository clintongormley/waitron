import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { beforeAll, expect, it } from "vitest";
import { createProduct } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  catalogues,
  departments,
  deviceKitchenScreenRemovals,
  deviceKitchenScreens,
  deviceKitchenScreenStations,
  deviceKitchenScreenZones,
  deviceProfileKitchenScreens,
  devices,
  kitchenStations,
  menuPeriods,
  routingCellPeriods,
  routingCells,
  stationDayStates,
  withTransaction,
  type Database,
  type Transaction,
  venueLocationId,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDevice, seedDeviceProfiles, seedVenue, seedZone } from "@waitron/db/testing/seed.js";
