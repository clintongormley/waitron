import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CATALOGUE_MIGRATIONS } from "@waitron/catalogue";
import {
  CORE_MIGRATIONS,
  deviceProfiles,
  floorZones,
  locations,
  withTransaction,
} from "@waitron/db";
import { randomUUID } from "node:crypto";
import type { Database, Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError, locationId as brandLocationId } from "@waitron/shared";
import type { LocationId } from "@waitron/shared";
import { VENUE_SERVICE_MIGRATIONS } from "./migrations.js";
import {
  configureZone,
  createDepartment,
  createServiceZone,
  deactivateDepartment,
  deactivateServiceZone,
  resolveNewOrderZone,
} from "./operations.js";
import {
  assertProfileZone,
  readProfileServiceAccess,
  readProfileServiceScopes,
  setProfileServiceAccess,
  setProfileServiceScope,
  type ProfileServiceAccessInput,
} from "./profile-access.js";
import {
  deviceProfileServiceAccess,
  deviceProfileZones,
  zoneServicePolicies,
} from "./schema/service.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, CATALOGUE_MIGRATIONS, VENUE_SERVICE_MIGRATIONS],
  timeoutMs: 60_000,
});

let db: Database;

beforeAll(() => {
  db = suite.db;
});

function scoped<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(db, fn);
}

/** The refusal's code and params, or the value it resolved with, so a test can compare it whole. */
async function outcome(promise: Promise<unknown>): Promise<unknown> {
  try {
    return { resolved: await promise };
  } catch (error) {
    if (error instanceof AppError) return { code: error.code, params: { ...error.params } };
    throw error;
  }
}

interface Venue {
  cfg: { locationId: LocationId };
  restaurant: string;
  deli: string;
  /** Restaurant zones; `terrace` sits before `dining` by position although it was created later. */
  dining: string;
  terrace: string;
  /** The Deli's only zone. */
  counter: string;
  profile: string;
}

async function seedLocation(name: string): Promise<LocationId> {
  const [row] = await db
    .insert(locations)
    .values({ name, invoiceLocales: ["en-GB"], operationDescription: "Hospitality" })
    .returning({ id: locations.id });
  return brandLocationId(row!.id);
}

async function seedProfile(): Promise<string> {
  const [row] = await db
    .insert(deviceProfiles)
    .values({ name: `Till ${randomUUID()}`, formFactor: "till" })
    .returning({ id: deviceProfiles.id });
  return row!.id;
}

/** Restaurant with two zones, Deli with one, and a till profile with nothing stored yet. */
async function seedVenue(): Promise<Venue> {
  const locationId = await seedLocation(`Venue ${randomUUID()}`);
  const cfg = { locationId };
  const ids = await scoped(async (tx) => {
    const restaurant = await createDepartment(tx, cfg, {
      name: "Restaurant",
      defaultServiceMode: "table_tab",
    });
    const deli = await createDepartment(tx, cfg, { name: "Deli", defaultServiceMode: "prepay" });
    const dining = await createServiceZone(tx, cfg, {
      name: "Dining room",
      departmentId: restaurant.id,
    });
    const terrace = await createServiceZone(tx, cfg, {
      name: "Terrace",
      departmentId: restaurant.id,
    });
    const counter = await createServiceZone(tx, cfg, { name: "Counter", departmentId: deli.id });
    await tx.update(floorZones).set({ displayOrder: 2 }).where(eq(floorZones.id, dining.id));
    await tx.update(floorZones).set({ displayOrder: 1 }).where(eq(floorZones.id, terrace.id));
    return {
      restaurant: restaurant.id,
      deli: deli.id,
      dining: dining.id,
      terrace: terrace.id,
      counter: counter.id,
    };
  });
  return { cfg, ...ids, profile: await seedProfile() };
}

function restaurantScope(
  venue: Venue,
  overrides: Partial<ProfileServiceAccessInput> = {},
): ProfileServiceAccessInput {
  return {
    departmentId: venue.restaurant,
    allowedZoneIds: null,
    startingZoneId: venue.dining,
    ...overrides,
  };
}

const save = (venue: Venue, input: ProfileServiceAccessInput) =>
  scoped((tx) => setProfileServiceAccess(tx, venue.cfg, venue.profile, input));
const read = (venue: Venue) =>
  scoped((tx) => readProfileServiceAccess(tx, venue.cfg, venue.profile));

/** No device holds the seeded profile, so `device_profile_form_factor_locked` lets it change. */
async function makeSharedDisplay(venue: Venue): Promise<void> {
  await db
    .update(deviceProfiles)
    .set({ formFactor: "kds" })
    .where(eq(deviceProfiles.id, venue.profile));
}

describe("a profile's service access", () => {
  it("has no department restriction while nothing is stored for the profile", async () => {
    const venue = await seedVenue();
    await expect(read(venue)).resolves.toEqual({
      departmentId: null,
      allowedZoneIds: null,
      startingZoneId: null,
    });
  });

  it("accepts a Restaurant profile starting in its own zone, and lists its zones by position", async () => {
    const venue = await seedVenue();
    await save(venue, restaurantScope(venue));
    await expect(read(venue)).resolves.toEqual({
      departmentId: venue.restaurant,
      allowedZoneIds: [venue.terrace, venue.dining],
      startingZoneId: venue.dining,
    });
  });

  it("keeps an explicit subset of the department's zones", async () => {
    const venue = await seedVenue();
    await save(
      venue,
      restaurantScope(venue, { allowedZoneIds: [venue.dining], startingZoneId: venue.dining }),
    );
    await expect(read(venue)).resolves.toMatchObject({
      allowedZoneIds: [venue.dining],
      startingZoneId: venue.dining,
    });
  });

  it("refuses the Deli's zone as an allowed zone of a Restaurant profile", async () => {
    const venue = await seedVenue();
    await expect(
      outcome(
        save(venue, restaurantScope(venue, { allowedZoneIds: [venue.dining, venue.counter] })),
      ),
    ).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "allowedZoneIds", reason: "outside_department" },
    });
  });

  it("refuses the Deli's zone as a Restaurant profile's starting zone", async () => {
    const venue = await seedVenue();
    await expect(
      outcome(save(venue, restaurantScope(venue, { startingZoneId: venue.counter }))),
    ).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "startingZoneId", reason: "outside_department" },
    });
  });

  it("refuses a starting zone outside the explicit subset", async () => {
    const venue = await seedVenue();
    await expect(
      outcome(
        save(
          venue,
          restaurantScope(venue, { allowedZoneIds: [venue.dining], startingZoneId: venue.terrace }),
        ),
      ),
    ).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "startingZoneId", reason: "outside_allowed" },
    });
  });

  it("refuses an empty explicit subset", async () => {
    const venue = await seedVenue();
    await expect(
      outcome(save(venue, restaurantScope(venue, { allowedZoneIds: [] }))),
    ).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "allowedZoneIds", reason: "empty" },
    });
  });

  it("refuses a department at another location", async () => {
    const venue = await seedVenue();
    const elsewhere = await seedVenue();
    await expect(
      outcome(
        save(
          venue,
          restaurantScope(venue, {
            departmentId: elsewhere.restaurant,
            startingZoneId: elsewhere.dining,
          }),
        ),
      ),
    ).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "departmentId", reason: "not_found" },
    });
  });

  it("refuses a disabled department", async () => {
    const venue = await seedVenue();
    await scoped((tx) => deactivateDepartment(tx, venue.cfg, venue.deli));
    await expect(
      outcome(
        save(venue, restaurantScope(venue, { departmentId: venue.deli, startingZoneId: null })),
      ),
    ).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "departmentId", reason: "not_found" },
    });
  });

  it("refuses a deactivated zone as the starting zone", async () => {
    const venue = await seedVenue();
    await scoped((tx) => deactivateServiceZone(tx, venue.cfg, venue.dining));
    await expect(outcome(save(venue, restaurantScope(venue)))).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "startingZoneId", reason: "unavailable" },
    });
  });

  it("requires a starting zone once a department is set", async () => {
    const venue = await seedVenue();
    await expect(
      outcome(save(venue, restaurantScope(venue, { startingZoneId: null }))),
    ).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "startingZoneId", reason: "required" },
    });
  });

  it("refuses zones without a department", async () => {
    const venue = await seedVenue();
    await expect(
      outcome(
        save(venue, {
          departmentId: null,
          allowedZoneIds: null,
          startingZoneId: venue.dining,
        }),
      ),
    ).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "startingZoneId", reason: "department_required" },
    });
    await expect(
      outcome(
        save(venue, {
          departmentId: null,
          allowedZoneIds: [venue.dining],
          startingZoneId: null,
        }),
      ),
    ).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "allowedZoneIds", reason: "department_required" },
    });
  });

  it("refuses a profile that does not exist", async () => {
    const venue = await seedVenue();
    const missing = { ...venue, profile: randomUUID() };
    await expect(outcome(save(missing, restaurantScope(venue)))).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "profileId", reason: "not_found" },
    });
  });

  it("refuses to read a profile that does not exist", async () => {
    const venue = await seedVenue();
    await expect(outcome(read({ ...venue, profile: randomUUID() }))).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "profileId", reason: "not_found" },
    });
  });

  it("leaves the stored access as it was when a save is refused", async () => {
    const venue = await seedVenue();
    await save(venue, restaurantScope(venue, { allowedZoneIds: [venue.dining] }));
    await expect(
      outcome(save(venue, restaurantScope(venue, { startingZoneId: venue.counter }))),
    ).resolves.toMatchObject({ code: "device_profile.access_invalid" });
    await expect(read(venue)).resolves.toMatchObject({
      departmentId: venue.restaurant,
      allowedZoneIds: [venue.dining],
      startingZoneId: venue.dining,
    });
  });

  it("clears the department restriction when saved with no department", async () => {
    const venue = await seedVenue();
    await save(venue, restaurantScope(venue, { allowedZoneIds: [venue.dining] }));
    await save(venue, {
      departmentId: null,
      allowedZoneIds: null,
      startingZoneId: null,
    });
    await expect(read(venue)).resolves.toEqual({
      departmentId: null,
      allowedZoneIds: null,
      startingZoneId: null,
    });
    expect(
      await db
        .select()
        .from(deviceProfileZones)
        .where(eq(deviceProfileZones.deviceProfileId, venue.profile)),
    ).toEqual([]);
  });

  it("expands every zone to the department's active zones when read", async () => {
    const venue = await seedVenue();
    await save(venue, restaurantScope(venue));
    const patio = await scoped(async (tx) => {
      const zone = await createServiceZone(tx, venue.cfg, {
        name: "Patio",
        departmentId: venue.restaurant,
      });
      await tx.update(floorZones).set({ displayOrder: 3 }).where(eq(floorZones.id, zone.id));
      await deactivateServiceZone(tx, venue.cfg, venue.terrace);
      return zone.id;
    });
    await expect(read(venue)).resolves.toMatchObject({
      allowedZoneIds: [venue.dining, patio],
      startingZoneId: venue.dining,
    });
  });

  it("stops offering an allowed zone once it is deactivated or moved to another department", async () => {
    const venue = await seedVenue();
    await save(
      venue,
      restaurantScope(venue, {
        allowedZoneIds: [venue.dining, venue.terrace],
        startingZoneId: venue.dining,
      }),
    );
    await scoped((tx) => deactivateServiceZone(tx, venue.cfg, venue.terrace));
    await expect(read(venue)).resolves.toMatchObject({ allowedZoneIds: [venue.dining] });

    const other = await seedVenue();
    await save(other, restaurantScope(other));
    await scoped((tx) =>
      configureZone(tx, other.cfg, { zoneId: other.terrace, departmentId: other.deli }),
    );
    await expect(read(other)).resolves.toMatchObject({ allowedZoneIds: [other.dining] });
  });

  it("starts in the first allowed zone by position once the starting zone is deactivated", async () => {
    const venue = await seedVenue();
    await scoped(async (tx) => {
      const zone = await createServiceZone(tx, venue.cfg, {
        name: "Patio",
        departmentId: venue.restaurant,
      });
      await tx.update(floorZones).set({ displayOrder: 0 }).where(eq(floorZones.id, zone.id));
    });
    // Patio sits first by position but is outside the subset, so it is never the fallback.
    await save(
      venue,
      restaurantScope(venue, {
        allowedZoneIds: [venue.dining, venue.terrace],
        startingZoneId: venue.dining,
      }),
    );
    await scoped((tx) => deactivateServiceZone(tx, venue.cfg, venue.dining));
    await expect(read(venue)).resolves.toMatchObject({
      allowedZoneIds: [venue.terrace],
      startingZoneId: venue.terrace,
    });
  });

  it("says the profile cannot order once no allowed zone is left", async () => {
    const venue = await seedVenue();
    await save(
      venue,
      restaurantScope(venue, { allowedZoneIds: [venue.dining], startingZoneId: venue.dining }),
    );
    await scoped((tx) => deactivateServiceZone(tx, venue.cfg, venue.dining));
    await expect(read(venue)).resolves.toEqual({
      departmentId: venue.restaurant,
      allowedZoneIds: [],
      startingZoneId: null,
    });
  });

  it("allows no zone, rather than every zone, when an explicit subset loses its rows", async () => {
    const venue = await seedVenue();
    await save(venue, restaurantScope(venue, { allowedZoneIds: [venue.dining] }));
    await db
      .delete(deviceProfileZones)
      .where(eq(deviceProfileZones.deviceProfileId, venue.profile));
    await expect(read(venue)).resolves.toMatchObject({ allowedZoneIds: [], startingZoneId: null });
  });

  it("says the profile cannot order once its department is disabled", async () => {
    const venue = await seedVenue();
    await save(venue, restaurantScope(venue));
    await scoped((tx) => deactivateDepartment(tx, venue.cfg, venue.restaurant));
    await expect(read(venue)).resolves.toMatchObject({
      departmentId: venue.restaurant,
      allowedZoneIds: [],
      startingZoneId: null,
    });
    await scoped((tx) =>
      tx
        .update(zoneServicePolicies)
        .set({ departmentId: venue.restaurant })
        .where(eq(zoneServicePolicies.zoneId, venue.counter)),
    );
    await expect(read(venue)).resolves.toMatchObject({ allowedZoneIds: [], startingZoneId: null });
  });

  it("refuses a department, zones or a starting zone on a shared display", async () => {
    const venue = await seedVenue();
    await makeSharedDisplay(venue);
    for (const [input, field] of [
      [restaurantScope(venue), "departmentId"],
      [
        {
          ...restaurantScope(venue),
          departmentId: null,
          startingZoneId: null,
          allowedZoneIds: [venue.dining],
        },
        "allowedZoneIds",
      ],
      [{ ...restaurantScope(venue), departmentId: null }, "startingZoneId"],
    ] as const) {
      await expect(outcome(save(venue, input))).resolves.toEqual({
        code: "device_profile.access_invalid",
        params: { field, reason: "shared_display" },
      });
    }
  });

  it("reads a shared display as having no department, whatever was stored before it became one", async () => {
    const venue = await seedVenue();
    await save(venue, restaurantScope(venue));
    await makeSharedDisplay(venue);
    await expect(read(venue)).resolves.toEqual({
      departmentId: null,
      allowedZoneIds: null,
      startingZoneId: null,
    });
  });

  it("is deleted with its profile", async () => {
    const venue = await seedVenue();
    await save(venue, restaurantScope(venue, { allowedZoneIds: [venue.dining] }));
    await db.delete(deviceProfiles).where(eq(deviceProfiles.id, venue.profile));
    expect(await db.select().from(deviceProfileServiceAccess)).toEqual([]);
    expect(
      await db
        .select()
        .from(deviceProfileZones)
        .where(eq(deviceProfileZones.deviceProfileId, venue.profile)),
    ).toEqual([]);
  });
});

describe("a profile's stored scope", () => {
  const scopes = (ids: string[]) => scoped((tx) => readProfileServiceScopes(tx, ids));
  const setScope = (venue: Venue, scope: Parameters<typeof setProfileServiceScope>[3]) =>
    scoped((tx) => setProfileServiceScope(tx, venue.cfg, venue.profile, scope));

  it("reads every zone as null, a subset by position, and a profile with none as all null", async () => {
    const venue = await seedVenue();
    const other = await seedProfile();
    await setScope(venue, {
      departmentId: venue.restaurant,
      allowedZoneIds: [venue.dining, venue.terrace],
      startingZoneId: venue.dining,
    });
    await expect(scopes([venue.profile, other])).resolves.toEqual([
      {
        profileId: venue.profile,
        departmentId: venue.restaurant,
        allowedZoneIds: [venue.terrace, venue.dining],
        startingZoneId: venue.dining,
      },
      { profileId: other, departmentId: null, allowedZoneIds: null, startingZoneId: null },
    ]);
    await setScope(venue, {
      departmentId: venue.restaurant,
      allowedZoneIds: null,
      startingZoneId: venue.terrace,
    });
    await expect(scopes([venue.profile])).resolves.toEqual([
      {
        profileId: venue.profile,
        departmentId: venue.restaurant,
        allowedZoneIds: null,
        startingZoneId: venue.terrace,
      },
    ]);
    await expect(scopes([])).resolves.toEqual([]);
  });

  it("still names a zone switched off since it was saved", async () => {
    const venue = await seedVenue();
    await setScope(venue, {
      departmentId: venue.restaurant,
      allowedZoneIds: [venue.dining, venue.terrace],
      startingZoneId: venue.dining,
    });
    await scoped((tx) => deactivateServiceZone(tx, venue.cfg, venue.terrace));
    await expect(scopes([venue.profile])).resolves.toMatchObject([
      { allowedZoneIds: [venue.terrace, venue.dining], startingZoneId: venue.dining },
    ]);
  });

  it("refuses a profile that is not a shared display without a department, and stores a shared display's none", async () => {
    const venue = await seedVenue();
    const none = { departmentId: null, allowedZoneIds: null, startingZoneId: null };
    await expect(outcome(setScope(venue, none))).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "departmentId", reason: "required" },
    });
    await makeSharedDisplay(venue);
    await expect(outcome(setScope(venue, none))).resolves.toEqual({ resolved: undefined });
  });

  it("keeps each field a save leaves out, and stores an explicit null zone list as every zone", async () => {
    const venue = await seedVenue();
    await setScope(venue, {
      departmentId: venue.restaurant,
      allowedZoneIds: [venue.dining, venue.terrace],
      startingZoneId: venue.dining,
    });
    await setScope(venue, { startingZoneId: venue.terrace });
    await expect(scopes([venue.profile])).resolves.toEqual([
      {
        profileId: venue.profile,
        departmentId: venue.restaurant,
        allowedZoneIds: [venue.terrace, venue.dining],
        startingZoneId: venue.terrace,
      },
    ]);
    await setScope(venue, { allowedZoneIds: null });
    await expect(scopes([venue.profile])).resolves.toEqual([
      {
        profileId: venue.profile,
        departmentId: venue.restaurant,
        allowedZoneIds: null,
        startingZoneId: venue.terrace,
      },
    ]);
    await setScope(venue, { departmentId: venue.deli, startingZoneId: venue.counter });
    await expect(scopes([venue.profile])).resolves.toEqual([
      {
        profileId: venue.profile,
        departmentId: venue.deli,
        allowedZoneIds: null,
        startingZoneId: venue.counter,
      },
    ]);
  });

  it("checks the stored value a save leaves out, refusing a narrowed list outside a new department", async () => {
    const venue = await seedVenue();
    await setScope(venue, {
      departmentId: venue.restaurant,
      allowedZoneIds: [venue.dining],
      startingZoneId: venue.dining,
    });
    await expect(
      outcome(setScope(venue, { departmentId: venue.deli, startingZoneId: venue.counter })),
    ).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "allowedZoneIds", reason: "outside_department" },
    });
    await expect(scopes([venue.profile])).resolves.toMatchObject([
      { departmentId: venue.restaurant, allowedZoneIds: [venue.dining] },
    ]);
  });

  it("leaves a stored scope alone when a save names none of it, even one naming a zone switched off since", async () => {
    const venue = await seedVenue();
    await setScope(venue, {
      departmentId: venue.restaurant,
      allowedZoneIds: [venue.dining, venue.terrace],
      startingZoneId: venue.dining,
    });
    await scoped((tx) => deactivateServiceZone(tx, venue.cfg, venue.terrace));
    await expect(outcome(setScope(venue, {}))).resolves.toEqual({ resolved: undefined });
    await expect(scopes([venue.profile])).resolves.toMatchObject([
      { allowedZoneIds: [venue.terrace, venue.dining], startingZoneId: venue.dining },
    ]);
    await expect(outcome(setScope(venue, { startingZoneId: venue.dining }))).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "allowedZoneIds", reason: "unavailable" },
    });
  });

  it("refuses a save naming none of the scope on a profile with no department stored", async () => {
    const venue = await seedVenue();
    await expect(outcome(setScope(venue, {}))).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "departmentId", reason: "required" },
    });
  });

  it("starts a shared display from no scope, clearing one stored before it became one", async () => {
    const venue = await seedVenue();
    await setScope(venue, {
      departmentId: venue.restaurant,
      allowedZoneIds: [venue.dining],
      startingZoneId: venue.dining,
    });
    await makeSharedDisplay(venue);
    await expect(outcome(setScope(venue, { startingZoneId: venue.dining }))).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "startingZoneId", reason: "shared_display" },
    });
    await expect(outcome(setScope(venue, {}))).resolves.toEqual({ resolved: undefined });
    await expect(scopes([venue.profile])).resolves.toEqual([
      { profileId: venue.profile, departmentId: null, allowedZoneIds: null, startingZoneId: null },
    ]);
  });

  it("checks a scope as a whole save does, refusing it on a shared display", async () => {
    const venue = await seedVenue();
    await expect(
      outcome(
        setScope(venue, {
          departmentId: venue.restaurant,
          allowedZoneIds: null,
          startingZoneId: venue.counter,
        }),
      ),
    ).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "startingZoneId", reason: "outside_department" },
    });
    await makeSharedDisplay(venue);
    await expect(
      outcome(
        setScope(venue, {
          departmentId: null,
          allowedZoneIds: null,
          startingZoneId: venue.counter,
        }),
      ),
    ).resolves.toEqual({
      code: "device_profile.access_invalid",
      params: { field: "startingZoneId", reason: "shared_display" },
    });
  });
});

describe("a zone checked against a profile", () => {
  const check = (venue: Venue, zoneId: string) =>
    outcome(scoped((tx) => assertProfileZone(tx, venue.cfg, venue.profile, zoneId)));
  const refused = (zoneId: string) => ({ code: "service_zone.not_allowed", params: { zoneId } });

  it("allows each zone of the profile and refuses another department's", async () => {
    const venue = await seedVenue();
    await save(venue, restaurantScope(venue));
    await expect(check(venue, venue.dining)).resolves.toEqual({ resolved: undefined });
    await expect(check(venue, venue.terrace)).resolves.toEqual({ resolved: undefined });
    await expect(check(venue, venue.counter)).resolves.toEqual(refused(venue.counter));
  });

  it("refuses a zone of the department outside the explicit subset", async () => {
    const venue = await seedVenue();
    await save(venue, restaurantScope(venue, { allowedZoneIds: [venue.dining] }));
    await expect(check(venue, venue.terrace)).resolves.toEqual(refused(venue.terrace));
  });

  it("refuses a zone moved to another department or deactivated after the profile was saved", async () => {
    const venue = await seedVenue();
    await save(venue, restaurantScope(venue));
    await scoped((tx) =>
      configureZone(tx, venue.cfg, { zoneId: venue.terrace, departmentId: venue.deli }),
    );
    await expect(check(venue, venue.terrace)).resolves.toEqual(refused(venue.terrace));
    await scoped((tx) => deactivateServiceZone(tx, venue.cfg, venue.dining));
    await expect(check(venue, venue.dining)).resolves.toEqual(refused(venue.dining));
  });

  it("allows every zone to a profile with no department", async () => {
    const venue = await seedVenue();
    await expect(check(venue, venue.counter)).resolves.toEqual({ resolved: undefined });
    await expect(check(venue, venue.dining)).resolves.toEqual({ resolved: undefined });
  });

  it("allows every zone to a shared display, whatever was stored before it became one", async () => {
    const venue = await seedVenue();
    await save(venue, restaurantScope(venue));
    await makeSharedDisplay(venue);
    await expect(check(venue, venue.counter)).resolves.toEqual({ resolved: undefined });
  });
});

describe("a new order's zone for a profile", () => {
  async function makeCounterDefault(zoneId: string): Promise<void> {
    await db
      .update(zoneServicePolicies)
      .set({ isCounterDefault: true })
      .where(eq(zoneServicePolicies.zoneId, zoneId));
  }
  const start = (venue: Venue, input: { zoneId?: string } = {}) =>
    outcome(
      scoped(async (tx) => {
        const context = await resolveNewOrderZone(tx, venue.cfg, {
          ...input,
          profileId: venue.profile,
        });
        return context.zoneId;
      }),
    );

  it("starts at the profile's starting zone rather than the counter default", async () => {
    const venue = await seedVenue();
    await makeCounterDefault(venue.counter);
    await save(venue, restaurantScope(venue, { startingZoneId: venue.dining }));
    await expect(start(venue)).resolves.toEqual({ resolved: venue.dining });
  });

  it("starts at the counter default for a profile with no department", async () => {
    const venue = await seedVenue();
    await makeCounterDefault(venue.counter);
    await expect(start(venue)).resolves.toEqual({ resolved: venue.counter });
  });

  it("starts at the first allowed zone once the starting zone is deactivated", async () => {
    const venue = await seedVenue();
    await makeCounterDefault(venue.counter);
    await save(venue, restaurantScope(venue, { startingZoneId: venue.dining }));
    await scoped((tx) => deactivateServiceZone(tx, venue.cfg, venue.dining));
    await expect(start(venue)).resolves.toEqual({ resolved: venue.terrace });
  });

  it("refuses a new order once the profile has no zone left", async () => {
    const venue = await seedVenue();
    await makeCounterDefault(venue.counter);
    await save(venue, restaurantScope(venue, { allowedZoneIds: [venue.dining] }));
    await scoped((tx) => deactivateServiceZone(tx, venue.cfg, venue.dining));
    await expect(start(venue)).resolves.toEqual({
      code: "device_profile.no_service_zone",
      params: { profileId: venue.profile },
    });
  });

  it("keeps an explicitly named zone, leaving its check to the caller", async () => {
    const venue = await seedVenue();
    await save(venue, restaurantScope(venue));
    await expect(start(venue, { zoneId: venue.counter })).resolves.toEqual({
      resolved: venue.counter,
    });
  });
});
