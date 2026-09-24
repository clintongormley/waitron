import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  invoiceSeries,
  kitchenStations,
  locations,
  nodes,
  tenants,
  tills,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { foldForUniqueness, persons, startManagementSession } from "@waitron/identity";
import { createDeviceProfile, listDeviceProfiles } from "@waitron/layouts";
import { AppError, locationId as brandLocationId, nodeId as brandNodeId } from "@waitron/shared";
import type { CapabilityFlag, FormFactor } from "@waitron/layouts";
import type { SeedReport, WaitronModule } from "@waitron/module";
import type { VenueAction } from "./venue-plan.js";
import "./errors.js";

export interface VenueApplyDeps {
  /** The connection to the TARGET database. */
  db: Database;
  /** The modules whose seeds a `seed-module` action may name — the enabled set, in the composition
   * list's order. */
  modules: readonly WaitronModule[];
  /** Optional configuration import that must commit or roll back with the freshly minted venue. */
  beforeCommit?: (tx: Transaction, result: VenueResult) => Promise<void>;
}

export interface VenueResult {
  locationId: string;
  tillId: string;
  nodeId: string;
  /** The ids of the series actually inserted, in plan order: `[standard, rectificative]` for a plan
   * `planVenue` built. A hand-built plan whose second series collides yields only `[standard]`. */
  seriesIds: string[];
  /** One entry per `seed-module` action run, in plan order: the module and its one-line report. */
  seeded: readonly SeedReport[];
}

/**
 * Runs one plan as ONE transaction, so no partial venue is ever left behind.
 *
 * A database contains one taxpayer and one operational venue. Repeating the same plan returns the
 * existing location, till, node and series without rerunning module seeds. A different location is
 * refused; so is a different taxpayer. Two overlapping plans cannot interleave: `withTransaction`
 * holds the file's write lock for the whole plan.
 */
export async function applyVenue(
  actions: readonly VenueAction[],
  deps: VenueApplyDeps,
): Promise<VenueResult> {
  const ensure = actions.find((a) => a.kind === "ensure-tenant");
  if (ensure === undefined || ensure.kind !== "ensure-tenant") {
    throw new Error("applyVenue: plan is missing ensure-tenant");
  }

  return withTransaction(deps.db, async (tx) => {
    let locationId = "";
    let tillId = "";
    let nodeId = "";
    let reusingVenue = false;
    const seeded: SeedReport[] = [];
    const seriesIds: string[] = [];

    for (const action of actions) {
      switch (action.kind) {
        case "ensure-tenant": {
          // The database holds ONE taxpayer, the row keyed `id = 1`. The untargeted
          // `on conflict do nothing` absorbs any re-run, same identity or not, so the read-back is
          // what tells the two apart. It compares with the same trim-and-upper-case `planVenue`
          // applies, so `es`/`ES` are the same taxpayer.
          await tx
            .insert(tenants)
            .values({
              id: 1,
              country: action.country,
              taxId: action.taxId,
              legalName: action.legalName,
            })
            .onConflictDoNothing();
          const stored = await tx
            .select({ country: tenants.country, taxId: tenants.taxId })
            .from(tenants)
            .where(eq(tenants.id, 1));
          const row = stored[0]!;
          const sameIdentity =
            row.country.trim().toUpperCase() === action.country.trim().toUpperCase() &&
            row.taxId.trim().toUpperCase() === action.taxId.trim().toUpperCase();
          if (!sameIdentity) {
            throw new AppError("provisioning.tenant_identity_mismatch", {});
          }
          break;
        }
        case "seed-admin": {
          // The admin belongs to the taxpayer, not to a venue, so a re-run must not add a second
          // one. Read-then-insert is safe because the write lock is held for the whole plan. The
          // insert goes through the table definition because `persons.id` and
          // `persons.created_at` are `$defaultFn` generators that only the insert builder runs.
          // `planVenue` refuses an unsupported `locale`; a hand-built plan's is not screened here.
          const seededAdmin = await tx
            .select({ id: persons.id })
            .from(persons)
            .where(eq(persons.role, "admin"))
            .limit(1);
          if (seededAdmin.length === 0) {
            await tx.insert(persons).values({
              displayName: action.displayName,
              firstNames: action.firstNames,
              lastNames: action.lastNames,
              locale: action.locale,
              pinHash: action.pinHash,
              passwordHash: action.passwordHash,
              email: action.email,
              // Without the folded twin, login falls back on an ASCII-only key and an address
              // with a non-ASCII character stops matching at sign-in.
              emailFolded: action.email === undefined ? undefined : foldForUniqueness(action.email),
              displayNameFolded: foldForUniqueness(action.displayName),
              role: "admin",
            });
          }
          break;
        }
        case "seed-device-profiles":
          await seedDeviceProfiles(tx, action.profiles);
          break;
        case "create-location": {
          const existing = await tx
            .select({
              id: locations.id,
              name: locations.name,
              invoiceLocales: locations.invoiceLocales,
              operationDescription: locations.operationDescription,
              fiscalTerritory: locations.fiscalTerritory,
              addressLine1: locations.addressLine1,
              addressLine2: locations.addressLine2,
              postalCode: locations.postalCode,
              city: locations.city,
              province: locations.province,
              timeZone: locations.timeZone,
              dayCutover: locations.dayCutover,
            })
            .from(locations)
            .orderBy(locations.id);
          if (existing.length > 1) {
            throw new AppError("provisioning.second_venue", {});
          }
          if (existing.length === 1) {
            const row = existing[0]!;
            const matches =
              row.name === action.name &&
              JSON.stringify(row.invoiceLocales) === JSON.stringify(action.invoiceLocales) &&
              row.operationDescription === action.operationDescription &&
              row.fiscalTerritory === action.fiscalTerritory &&
              row.addressLine1 === action.addressLine1 &&
              row.addressLine2 === action.addressLine2 &&
              row.postalCode === action.postalCode &&
              row.city === action.city &&
              row.province === action.province &&
              row.timeZone === action.timeZone &&
              row.dayCutover === action.dayCutover;
            if (!matches) {
              throw new AppError("provisioning.second_venue", {});
            }
            locationId = row.id;
            reusingVenue = true;
            break;
          }
          locationId = randomUUID();
          await tx.insert(locations).values({
            id: locationId,
            name: action.name,
            invoiceLocales: [...action.invoiceLocales],
            operationDescription: action.operationDescription,
            fiscalTerritory: action.fiscalTerritory,
            addressLine1: action.addressLine1,
            addressLine2: action.addressLine2,
            postalCode: action.postalCode,
            city: action.city,
            province: action.province,
            timeZone: action.timeZone,
            dayCutover: action.dayCutover,
          });
          // A line with no more specific route fires to the default station; with no active
          // default, firing fails with `station.no_default`. So a fresh venue ships one.
          await tx.insert(kitchenStations).values({
            locationId,
            name: "Cocina",
            displayOrder: 0,
            isDefault: true,
            active: true,
          });
          break;
        }
        case "create-till":
          // Ordering guards throw a plain Error, not an AppError: a malformed plan is a programming
          // bug, not operator input.
          if (locationId === "") throw new Error("applyVenue: create-till before create-location");
          if (reusingVenue) {
            const existing = await tx
              .select({ id: tills.id, name: tills.name })
              .from(tills)
              .where(eq(tills.locationId, locationId))
              .orderBy(tills.id)
              .limit(1);
            if (existing[0] === undefined || existing[0].name !== action.name) {
              throw new AppError("provisioning.second_venue", {});
            }
            tillId = existing[0].id;
            break;
          }
          tillId = randomUUID();
          await tx.insert(tills).values({ id: tillId, locationId, name: action.name });
          break;
        case "create-node":
          if (locationId === "") throw new Error("applyVenue: create-node before create-location");
          if (reusingVenue) {
            const existing = await tx
              .select({
                id: nodes.id,
                name: nodes.name,
                filingModule: nodes.filingModule,
                taxModule: nodes.taxModule,
              })
              .from(nodes)
              .where(eq(nodes.locationId, locationId))
              .orderBy(nodes.id)
              .limit(1);
            if (
              existing[0] === undefined ||
              existing[0].name !== action.name ||
              existing[0].filingModule !== action.filingModule ||
              existing[0].taxModule !== action.taxModule
            ) {
              throw new AppError("provisioning.second_venue", {});
            }
            nodeId = existing[0].id;
            break;
          }
          nodeId = randomUUID();
          await tx.insert(nodes).values({
            id: nodeId,
            locationId,
            name: action.name,
            filingModule: action.filingModule,
            taxModule: action.taxModule,
          });
          break;
        case "seed-module": {
          if (nodeId === "") throw new Error("applyVenue: seed-module before create-node");
          const seed = deps.modules.find((m) => m.name === action.module)?.provisioning?.seed;
          if (seed === undefined) {
            throw new Error(
              `applyVenue: seed-module names ${action.module}, which is not in deps.modules or declares no seed`,
            );
          }
          if (reusingVenue) break;
          const report = await seed.run(tx, {
            locationId: brandLocationId(locationId),
            nodeId: brandNodeId(nodeId),
          });
          seeded.push({ module: action.module, report });
          break;
        }
        case "create-series": {
          if (nodeId === "") throw new Error("applyVenue: create-series before create-node");
          if (reusingVenue) {
            const existing = await tx
              .select({ id: invoiceSeries.id })
              .from(invoiceSeries)
              .where(
                and(
                  eq(invoiceSeries.nodeId, nodeId),
                  eq(invoiceSeries.code, action.code),
                  eq(invoiceSeries.purpose, action.purpose),
                ),
              );
            if (existing[0] === undefined) {
              throw new AppError("provisioning.second_venue", {});
            }
            seriesIds.push(existing[0].id);
            break;
          }
          const seriesId = randomUUID();
          const inserted = await tx
            .insert(invoiceSeries)
            .values({
              id: seriesId,
              nodeId,
              code: action.code,
              purpose: action.purpose,
            })
            .onConflictDoNothing({ target: [invoiceSeries.nodeId, invoiceSeries.code] })
            .returning({ id: invoiceSeries.id });
          // A collision returns no row; pushing `seriesId` anyway would name a row that does not
          // exist.
          if (inserted.length > 0) seriesIds.push(seriesId);
          break;
        }
      }
    }

    // The ordering guards fire only when a dependent action runs, so a plan that omits create-node
    // (with everything depending on it) or create-till reaches here with an empty id.
    if (nodeId === "") throw new Error("applyVenue: plan is missing create-node");
    if (tillId === "") throw new Error("applyVenue: plan is missing create-till");
    const result = { locationId, tillId, nodeId, seriesIds, seeded };
    await deps.beforeCommit?.(tx, result);
    return result;
  });
}

/**
 * Creates each missing profile through `createDeviceProfile`, the dashboard's own store path, so its
 * capability validation and `till.configure` gate apply here too. That needs a management session,
 * which only the admin seed-admin created can open.
 */
async function seedDeviceProfiles(
  tx: Transaction,
  profiles: {
    name: string;
    formFactor: FormFactor;
    capabilities: CapabilityFlag[];
    inactivityTimeoutSeconds: number | null;
  }[],
): Promise<void> {
  // Find-or-create by NAME, so a re-run re-creates a seeded profile the owner has since renamed.
  const existing = new Set((await listDeviceProfiles(tx)).map((p) => p.name));
  const toCreate = profiles.filter((p) => !existing.has(p.name));
  if (toCreate.length === 0) return;

  const admin = await tx
    .select({ id: persons.id })
    .from(persons)
    .where(eq(persons.role, "admin"))
    .limit(1);
  const personId = admin[0]?.id;
  if (personId === undefined) {
    throw new Error("applyVenue: seed-device-profiles before seed-admin");
  }
  const session = await startManagementSession(tx, { personId });
  for (const profile of toCreate) {
    await createDeviceProfile(tx, {
      managementSessionId: session.token,
      name: profile.name,
      formFactor: profile.formFactor,
      canvasId: null,
      capabilities: profile.capabilities,
      inactivityTimeoutSeconds: profile.inactivityTimeoutSeconds,
    });
  }
}
