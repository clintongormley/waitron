import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { parties, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { planVenue, type VenueRequest } from "@waitron/provisioning";
import { applyAllocatedTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { serviceStepCompletions, serviceSteps } from "@waitron/venue-service";
import { ALL_MODULES } from "./modules.js";
import { createClockVenue } from "./testing/clock-venue.js";
import { schemaVersionsByModule } from "./backup-manifest.js";
import {
  buildConfigurationBundle,
  exportConfigurationTables,
  importConfigurationTables,
} from "./configuration-transfer.js";

const source = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const target = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

it("a configuration import over a venue whose closed party has a completed step succeeds and leaves no completion", async () => {
  const at = new Date("2026-10-22T20:00:00Z");
  const venue = await createClockVenue(source.db, () => at);
  const versions = await schemaVersionsByModule(source.db, ALL_MODULES);
  const exported = await exportConfigurationTables(source.db, ALL_MODULES);
  const [operator] = await source.db
    .select({ id: persons.id })
    .from(persons)
    .where(eq(persons.role, "admin"));
  const bundle = {
    ...(await buildConfigurationBundle(
      source.db,
      { ...venue.cfg, sourceOperatorId: operator!.id },
      ALL_MODULES,
      at,
      versions,
    )),
    ...exported,
  };
  const request: VenueRequest = {
    country: "ES",
    taxId: "B20202020",
    legalName: "Imported SL",
    location: {
      name: "Imported venue",
      fiscalTerritory: "ES-common",
      invoiceLocales: ["es-ES"],
      operationDescription: "Restaurant",
      addressLine1: "Calle Mayor 2",
      addressLine2: null,
      postalCode: "28013",
      city: "Madrid",
      province: "Madrid",
      timeZone: "Europe/Madrid",
      dayCutover: "05:00",
    },
    seriesCode: "A",
    rectificativeSeriesCode: "R",
    admin: {
      displayName: "Owner",
      pinHash: "scrypt$00$00",
      passwordHash: "scrypt$00$00",
      email: "owner@example.test",
    },
  };
  let partyId = "";
  await applyVenue(planVenue(request, ALL_MODULES), {
    db: target.db,
    modules: ALL_MODULES,
    beforeCommit: async (tx, installed) => {
      const [step] = await tx.select({ id: serviceSteps.id }).from(serviceSteps).limit(1);
      expect(step).toBeDefined();
      const [party] = await tx
        .insert(parties)
        .values({
          openedBy: "sender",
          state: "closed",
          closedAt: "2026-10-22T21:00:00.000Z",
          closedBy: "sender",
        })
        .returning({ id: parties.id });
      partyId = party!.id;
      await tx.insert(serviceStepCompletions).values({
        partyId,
        stepId: step!.id,
        doneAt: "2026-10-22T20:33:00.000Z",
        doneBy: "waiter-1",
      });
      await importConfigurationTables(tx, bundle, installed, ALL_MODULES, versions);
    },
  });
  await withTransaction(target.db, async (tx) => {
    expect(await tx.select().from(serviceStepCompletions)).toEqual([]);
    expect(
      await tx.select({ state: parties.state }).from(parties).where(eq(parties.id, partyId)),
    ).toEqual([{ state: "closed" }]);
  });
});
