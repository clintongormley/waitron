import { deviceId as brandDeviceId, nodeId as brandNodeId } from "@waitron/shared";
import type { DeviceId, LocationId, NodeId } from "@waitron/shared";
import type { Database } from "../client.js";
import { deviceFormFactorEnum, deviceProfiles } from "../schema/device-profiles.js";
import { devices } from "../schema/devices.js";
import { kitchenStations } from "../schema/kitchen-stations.js";
import { nodes } from "../schema/nodes.js";
import { tenants } from "../schema/tenants.js";

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
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: freshNif(), legalName: "Test SL" })
    .onConflictDoNothing({ target: tenants.id });
}

/** Seeds one node at `location` and returns its id. */
export async function seedNode(db: Database, location: LocationId): Promise<NodeId> {
  const [row] = await db
    .insert(nodes)
    .values({ locationId: location, name: "Test node" })
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

/** Pairs one active device at `locationId`, on `profileId` or on a new profile of `formFactor` (till
 * by default). */
export async function seedDevice(
  db: Database,
  opts: {
    locationId: LocationId | string;
    label?: string;
    formFactor?: Exclude<(typeof deviceFormFactorEnum.enumValues)[number], "kds">;
    capabilities?: string[];
    profileId?: string;
  },
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
      locationId: opts.locationId,
      deviceProfileId: profileId,
      label,
      tokenHash: "seeded",
    })
    .returning({ id: devices.id });
  return { deviceId: brandDeviceId(row!.id), profileId };
}
