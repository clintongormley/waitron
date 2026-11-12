import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  departments,
  deviceProfileKitchenScreens,
  deviceProfileKitchenScreenStations,
  floorZones,
  withTransaction,
  catalogues,
  kitchenStations,
  venueLocationId,
} from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedDeviceProfiles, seedNode, seedVenue, seedZone } from "@waitron/db/testing/seed.js";
