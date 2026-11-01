import { sql } from "drizzle-orm";
import { deviceId as brandDeviceId, nodeId as brandNodeId } from "@waitron/shared";
import type { DeviceId, LocationId, NodeId } from "@waitron/shared";
import type { Database } from "../client.js";
import { deviceFormFactorEnum, deviceProfiles } from "../schema/device-profiles.js";
import { devices } from "../schema/devices.js";
import { kitchenStations } from "../schema/kitchen-stations.js";
import { nodes } from "../schema/nodes.js";
import { workingOrders } from "../schema/orders.js";
import { locations } from "../schema/tenants.js";
import { nowIso } from "../schema/columns.js";
import { venueLocationId, type Venue } from "../venue.js";

// The taxpayer row is a singleton keyed on id = 1, so a suite has at most one NIF in play and a
// second seed is a no-op. The counter survives because other fixtures still mint their own NIFs for
// rows that are not the taxpayer (a restore's recorded identity, for one), and because a suite that
// truncates `tenants` between tests re-seeds a row whose NIF need not repeat.
let nifCounter = 0;

/** Returns a NIF unused so far in this test run. */
export function freshNif(): string {
  nifCounter += 1;
  return `${String(40_000_000 + nifCounter).padStart(8, "0")}K`;
}

/**
 * Makes sure the database's ONE taxpayer row exists. Idempotent: `tenants.id` is pinned to 1 by its
 * primary key and `tenants_singleton_ck`, so a second call adds nothing and returns nothing to
 * scope a query by.
 */
export async function seedTenant(db: Database): Promise<void> {
  // Plain SQL: upgrade tests seed a database migrated only to an earlier point, where today's
  // columns do not exist yet.
  await db.run(sql`insert into tenants (id, country, tax_id, legal_name, created_at)
    values (1, 'ES', ${freshNif()}, 'Test SL', ${nowIso()})
    on conflict (id) do nothing`);
}

/** Writes the taxpayer row ({@link seedTenant}) and the one venue; refuses a second venue. */
export async function seedVenue(db: Database, overrides: Partial<Venue> = {}): Promise<void> {
  const [existing] = await db.select({ id: locations.id }).from(locations).limit(1);
  if (existing) throw new Error(`seedVenue: a venue row already exists (${existing.id})`);
  await seedTenant(db);
  const { defaultCatalogueId, ...columns } = overrides;
  await db.insert(locations).values({
    name: "Test venue",
    invoiceLocales: ["es"],
    operationDescription: "Restaurant",
    ...columns,
    ...(defaultCatalogueId === undefined ? {} : { catalogueId: defaultCatalogueId }),
  });
}

/** Seeds one node and returns its id: at the venue unless `location` is given. */
export async function seedNode(db: Database, location?: LocationId): Promise<NodeId> {
  const [row] = await db
    .insert(nodes)
    .values({ locationId: location ?? (await venueLocationId(db)), name: "Test node" })
    .returning({ id: nodes.id });
  return brandNodeId(row!.id);
}

/** Seeds one kitchen station for `locationId` and returns its id. Defaults to the DEFAULT station
 * named 'Cocina' — the fixture shape the till suites need so a fire's default-station fallback
 * ({@link fireLines}) resolves. */
export async function seedKitchenStation(
  db: Database,
  opts: { locationId: LocationId; name?: string; isDefault?: boolean },
): Promise<string> {
  const { locationId, name = "Cocina", isDefault = true } = opts;
  const [row] = await db
    .insert(kitchenStations)
    .values({ locationId, name, isDefault })
    .returning({ id: kitchenStations.id });
  return row!.id;
}

let deviceCounter = 0;

/** Pairs one active device at `locationId` (the venue when omitted), on `profileId` or on a new
 * profile of `formFactor` (till by default). */
export async function seedDevice(
  db: Database,
  opts: {
    locationId?: LocationId | string;
    label?: string;
    formFactor?: Exclude<(typeof deviceFormFactorEnum.enumValues)[number], "kds">;
    capabilities?: string[];
    profileId?: string;
  } = {},
): Promise<{ deviceId: DeviceId; profileId: string }> {
  deviceCounter += 1;
  const label = opts.label ?? `Device ${deviceCounter}`;
  const profileId =
    opts.profileId ??
    (
      await db
        .insert(deviceProfiles)
        .values({
          name: `Profile ${deviceCounter}`,
          formFactor: opts.formFactor ?? "till",
          capabilities: opts.capabilities ?? [],
        })
        .returning({ id: deviceProfiles.id })
    )[0]!.id;
  const [row] = await db
    .insert(devices)
    .values({
      locationId: opts.locationId ?? (await venueLocationId(db)),
      deviceProfileId: profileId,
      label,
      tokenHash: "seeded",
    })
    .returning({ id: devices.id });
  return { deviceId: brandDeviceId(row!.id), profileId };
}

/** Seeds one working order at the venue and returns the row. Defaults to source "dashboard" (which
 * needs no device) and order number 1. */
export async function seedWorkingOrder(
  db: Database,
  values: Partial<Omit<typeof workingOrders.$inferInsert, "locationId">> = {},
): Promise<typeof workingOrders.$inferSelect> {
  const [row] = await db
    .insert(workingOrders)
    .values({
      source: "dashboard",
      orderNumber: 1,
      ...values,
      locationId: await venueLocationId(db),
    })
    .returning();
  return row!;
}
