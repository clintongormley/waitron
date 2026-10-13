import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import {
  invoiceSeries,
  kitchenStations,
  kitchenTimingDefaults,
  locations,
  locationDayCutoverChanges,
  nodes,
  tenants,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { foldForUniqueness, persons, startManagementSession } from "@waitron/identity";
import { createDeviceProfile, listDeviceProfiles } from "@waitron/layouts";
import {
  AppError,
  businessDayAt,
  cutoverForBusinessDay,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  normaliseUuid,
} from "@waitron/shared";
import type { CapabilityFlag, FormFactor } from "@waitron/layouts";
import type { SeedReport, WaitronModule } from "@waitron/module";
import {
  moduleOperationFor,
  readOperationAuthority,
  withOperationAuthority,
  withPreparedModuleOperations,
  type ModuleOperations,
} from "@waitron/module";
import type { VenueAction } from "./venue-plan.js";
import { normalizeDayCutover } from "./venue-plan.js";
import "./errors.js";

export interface VenueApplyDeps {
  /** The connection to the TARGET database. */
  db: Database;
  /** The modules whose seeds a `seed-module` action may name — the enabled set, in the composition
   * list's order. */
  modules: readonly WaitronModule[];
  moduleInputs?: ReadonlyMap<string, InitialModuleInput>;
  // A signed outside consumption names these identities before the venue transaction begins.
  initialNodeId?: string;
  initialAdministratorId?: string;
  /** Optional configuration import that must commit or roll back with the freshly minted venue. */
  beforeCommit?: (tx: Transaction, result: VenueResult) => Promise<void>;
}

export interface InitialModuleInput {
  readonly eventId: string;
  readonly sourceId: string;
  readonly input: unknown;
}

export interface VenueResult {
  locationId: string;
  nodeId: string;
  /** The active series ids, in the plan's purpose order. */
  seriesIds: string[];
  /** One entry per `seed-module` action run, in plan order: the module and its one-line report. */
  seeded: readonly SeedReport[];
}

export async function applyVenue(
  suppliedActions: readonly VenueAction[],
  deps: VenueApplyDeps,
): Promise<VenueResult> {
  const actions = structuredClone(suppliedActions);
  const modules = [...deps.modules];
  const ensure = actions.find((a) => a.kind === "ensure-tenant");
  if (ensure === undefined || ensure.kind !== "ensure-tenant") {
    throw new Error("applyVenue: plan is missing ensure-tenant");
  }
  const inputs = new Map(
    [...(deps.moduleInputs ?? [])].map(([name, input]) => [name, { ...input }]),
  );
  const initialNodeId = brandNodeId(deps.initialNodeId ?? randomUUID());
  const initialAdministratorId = normaliseUuid(
    deps.initialAdministratorId ?? randomUUID(),
    "PersonId",
  );
  const filingModule = actions.find((action) => action.kind === "create-node")?.filingModule;
  const seriesOwners = modules.filter((module) => module.provisioning?.seed?.series);
  if (seriesOwners.length > 1 || seriesOwners.some((module) => module.fiscal?.id !== filingModule))
    throw new Error("applyVenue: only the filing module may own initial series");
  const seriesOwner = seriesOwners[0];
  if (
    seriesOwner !== undefined &&
    !actions.some((action) => action.kind === "seed-module" && action.module === seriesOwner.name)
  )
    throw new Error("applyVenue: series owner is missing its seed action");
  const resolveSeries = seriesOwner?.provisioning?.seed?.series?.resolve;
  const seriesBases = actions
    .filter((action) => action.kind === "create-series")
    .map(({ code, purpose }) => ({ code, purpose }));

  const run = async (tx: Transaction, prepared: ModuleOperations): Promise<VenueResult> => {
    let locationId = "";
    let nodeId = "";
    let reusingVenue = false;
    let createdAdministrator: string | undefined;
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
              taxpayerDomicile: action.taxpayerDomicile ?? null,
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
          const seededAdmin = await tx
            .select({ id: persons.id })
            .from(persons)
            .where(eq(persons.role, "admin"))
            .limit(1);
          if (seededAdmin.length === 0) {
            const [created] = await tx
              .insert(persons)
              .values({
                id: initialAdministratorId,
                displayName: action.displayName,
                firstNames: action.firstNames,
                lastNames: action.lastNames,
                locale: action.locale,
                pinHash: action.pinHash,
                passwordHash: action.passwordHash,
                email: action.email,
                // Without the folded twin, login falls back on an ASCII-only key and an address
                // with a non-ASCII character stops matching at sign-in.
                emailFolded:
                  action.email === undefined ? undefined : foldForUniqueness(action.email),
                displayNameFolded: foldForUniqueness(action.displayName),
                role: "admin",
              })
              .returning({ id: persons.id });
            createdAdministrator = created!.id;
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
            const changes = await tx
              .select({
                effectiveBusinessDay: locationDayCutoverChanges.effectiveBusinessDay,
                dayCutover: locationDayCutoverChanges.dayCutover,
              })
              .from(locationDayCutoverChanges)
              .where(eq(locationDayCutoverChanges.locationId, row.id))
              .orderBy(asc(locationDayCutoverChanges.effectiveBusinessDay));
            const clock = {
              timeZone: row.timeZone,
              dayCutover: normalizeDayCutover(row.dayCutover).slice(0, 5),
              cutoverChanges: changes.map((change) => ({
                ...change,
                dayCutover: normalizeDayCutover(change.dayCutover).slice(0, 5),
              })),
            };
            const currentCutover = cutoverForBusinessDay(clock, businessDayAt(clock, new Date()));
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
              currentCutover === normalizeDayCutover(action.dayCutover).slice(0, 5);
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
          await tx.insert(kitchenTimingDefaults).values({ locationId });
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
        case "create-node":
          // Ordering guards throw a plain Error, not an AppError: a malformed plan is a programming
          // bug, not operator input.
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
          nodeId = initialNodeId;
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
          const seed = modules.find((m) => m.name === action.module)?.provisioning?.seed;
          if (seed === undefined) {
            throw new Error(
              `applyVenue: seed-module names ${action.module}, which is not in deps.modules or declares no seed`,
            );
          }
          if (reusingVenue) break;
          const node = {
            locationId: brandLocationId(locationId),
            nodeId: brandNodeId(nodeId),
          };
          const input = inputs.get(action.module);
          let report: string;
          if (input === undefined) {
            report = await seed.run(tx, node);
          } else {
            const [operator] =
              createdAdministrator === undefined
                ? []
                : await tx
                    .select({ id: persons.id, role: persons.role, status: persons.status })
                    .from(persons)
                    .where(eq(persons.id, createdAdministrator));
            if (operator?.role !== "admin" || operator.status !== "active")
              throw new AppError("provisioning.initial_operator_required", {});
            const binding = Object.freeze({
              module: action.module,
              action: "setup",
              eventId: input.eventId,
              sourceId: input.sourceId,
              targetNodeId: nodeId,
            });
            const collected = moduleOperationFor(prepared, action.module, nodeId, "setup");
            if (collected === undefined) {
              report = await withOperationAuthority(binding, operator.id, (authority) =>
                seed.run(tx, node, Object.freeze({ input: input.input, binding, authority })),
              );
            } else {
              if (
                readOperationAuthority(collected.authority, collected.binding)?.operatorId !==
                operator.id
              )
                throw new AppError("provisioning.initial_operator_required", {});
              report = await seed.run(tx, node, collected);
              moduleOperationFor(prepared, action.module, nodeId, "setup");
            }
          }
          seeded.push({ module: action.module, report });
          break;
        }
        case "create-series": {
          if (nodeId === "") throw new Error("applyVenue: create-series before create-node");
          if (resolveSeries !== undefined) break;
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
    // (with everything depending on it) reaches here with an empty id.
    if (nodeId === "") throw new Error("applyVenue: plan is missing create-node");
    if (resolveSeries !== undefined) {
      const references = (
        await resolveSeries(
          tx,
          { locationId: brandLocationId(locationId), nodeId: brandNodeId(nodeId) },
          seriesBases.map((base) => ({ ...base })),
        )
      ).map((reference) => ({ ...reference }));
      const active = await tx
        .select({
          id: invoiceSeries.id,
          code: invoiceSeries.code,
          purpose: invoiceSeries.purpose,
        })
        .from(invoiceSeries)
        .where(and(eq(invoiceSeries.nodeId, nodeId), isNull(invoiceSeries.retiredAt)));
      if (
        seriesBases.length === 0 ||
        new Set(seriesBases.map((base) => base.purpose)).size !== seriesBases.length ||
        references.length !== seriesBases.length ||
        active.length !== references.length ||
        new Set(references.map((reference) => reference.id)).size !== references.length ||
        seriesBases.some(
          (base) =>
            references.filter((reference) => reference.purpose === base.purpose).length !== 1,
        ) ||
        references.some(
          (reference) =>
            !active.some(
              (row) =>
                row.id === reference.id &&
                row.code === reference.code &&
                row.purpose === reference.purpose,
            ),
        )
      )
        throw new AppError("provisioning.second_venue", {});
      seriesIds.push(
        ...seriesBases.map(
          (base) => references.find((reference) => reference.purpose === base.purpose)!.id,
        ),
      );
    }
    const result = { locationId, nodeId, seriesIds, seeded };
    await deps.beforeCommit?.(tx, result);
    for (const [name] of prepared) moduleOperationFor(prepared, name, nodeId, "setup");
    return result;
  };
  const transact = (prepared: ModuleOperations) =>
    withTransaction(deps.db, (tx) => run(tx, prepared));
  const collecting = modules.filter(
    (module) =>
      module.operations !== undefined &&
      inputs.has(module.name) &&
      actions.some((action) => action.kind === "seed-module" && action.module === module.name),
  );
  if (collecting.length === 0) return transact(new Map());
  const [existingVenue] = await deps.db.select({ id: locations.id }).from(locations).limit(1);
  if (existingVenue !== undefined) return transact(new Map());
  const [existingAdministrator] = await deps.db
    .select({ id: persons.id })
    .from(persons)
    .where(eq(persons.role, "admin"))
    .limit(1);
  if (
    existingAdministrator !== undefined ||
    !actions.some((action) => action.kind === "seed-admin")
  )
    throw new AppError("provisioning.initial_operator_required", {});
  // The seed checks that this planned operator is the newly inserted active administrator.
  const authorise = (index: number, operations: ModuleOperations): Promise<VenueResult> => {
    const module = collecting[index];
    if (module === undefined)
      return withPreparedModuleOperations(collecting, operations, initialNodeId, "setup", transact);
    const input = inputs.get(module.name)!;
    const binding = Object.freeze({
      module: module.name,
      action: "setup",
      eventId: input.eventId,
      sourceId: input.sourceId,
      targetNodeId: initialNodeId,
    });
    return withOperationAuthority(binding, initialAdministratorId, (authority) => {
      const next = new Map(operations);
      next.set(module.name, { input: input.input, binding, authority });
      return authorise(index + 1, next);
    });
  };
  return authorise(0, new Map());
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
