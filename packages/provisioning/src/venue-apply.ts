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
  /** The OWNER connection to the TARGET database — the admin that ran `instance` and so owns the
   * tables. The owner inserts the venue scaffold without widening app_user grants. */
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
  /** The ids of the series actually inserted, in plan order: `[standard, rectificative]`. planVenue
   * rejects equal standard/rectificative codes, so a valid plan always yields exactly those two, in
   * that order; a hand-built plan whose second series collides yields only `[standard]` (the
   * create-series gate below never returns a phantom id for a row it did not insert). */
  seriesIds: string[];
  /** One entry per `seed-module` action run, in plan order: the module and its one-line report. */
  seeded: readonly SeedReport[];
}

/**
 * Runs one plan as ONE transaction under `withTransaction`, mirroring provisionNode. A single
 * transaction is what a partial venue must never be. (This used to contrast with `applyInstance`,
 * which ran cluster DDL outside a transaction; that path was deleted with the storage switch.)
 *
 * A database contains one taxpayer and one operational venue. Repeating the same plan returns the
 * existing location, till, node and series without rerunning module seeds. A different location is
 * refused; so is a different taxpayer. Two plans that overlap are serialised by the ENGINE, not by
 * anything this function does: SQLite admits one writer per file and `withTransaction` holds that
 * write lock for the whole plan. See the ensure-tenant case.
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
          // The database holds ONE taxpayer, the row keyed `id = 1`: write it if it is not there,
          // then read back whatever is there and decide — the same identity is nothing to do, a
          // different identity is refused by name.
          //
          // Nothing here arbitrates between two concurrent plans, because the engine does it: a
          // write transaction opens with `begin immediate`, which takes the file's write lock up
          // front, and SQLite admits one writer per file
          // (`packages/store/src/write-queue.ts:13-21`). `withTransaction` runs the whole plan
          // inside that lock, so a second plan does not start until this one has committed or
          // rolled back. The `select … for update` that used to take the lock explicitly is gone —
          // this engine refuses it outright with `near "for": syntax error`. Measured rather than
          // argued: put it back on this read and `venue-apply.test.ts` plus `cli.test.ts` go from
          // 1 failing case of 159 to 28, twenty-seven of them reporting that text.
          //
          // `on conflict do nothing` names NO arbiter deliberately, and what it absorbs is a
          // RE-RUN rather than a race: a second `applyVenue` with the same plan clashes on the
          // pinned primary key, and one carrying a different identity clashes there too, so the
          // read-back below is what tells the two apart.
          //
          // Comparison is on the canonical values (trimmed, upper-cased — the same normalisation
          // `planVenue` applies before it builds the action), so `es`/`ES` and stray surrounding
          // space are the SAME taxpayer and the re-run stays idempotent.
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
          // Seed the venue's admin ONCE. Like ensure-tenant's `on conflict do nothing`, this
          // makes a re-run a no-op — the admin belongs to the taxpayer, not to a venue, so an idempotent
          // same-venue re-run must not add a duplicate admin. A plain insert did exactly
          // that. A read for any `role='admin'` row, then an insert only when there is none, seeds
          // the admin once; why it goes through the table definition is at the insert itself.
          // `pin_hash` (till) and `password_hash`
          // (dashboard) are already scrypt hashes, hashed at the CLI boundary, never a plaintext
          // secret. `role='admin'` is the whole point: this person can log in and authorize privileged
          // actions from day one. `email` is the admin's required dashboard-login address, validated
          // and normalized at the request boundary and written verbatim here.
          // `first_names`/`last_names` are the person's real name, and `locale` the UI language they
          // prefer — the DISPLAY language, nothing to do with the location's `invoice_locales`. All
          // three are nullable columns carrying an `is null or length > 0` check, so the planner's
          // `null` for "not given" is accepted and an empty string would not be. A null `locale`
          // means this person has no preference of their own and the apps fall back to the venue
          // default. A plan built by `planVenue` cannot carry a language the apps have no catalogue
          // for — it refuses one — but this applier runs whatever action list it is handed, and the
          // action's `locale` is a plain `string | null`, so a hand-built plan is not screened here.
          //
          // Read-then-insert, where this used to be one `insert … select … where not exists`. The
          // two are equivalent here because the plan runs alone: `withTransaction` holds the file's
          // write lock for its whole body (`packages/store/src/write-queue.ts:13-21`), so no second
          // transaction can seed an admin between the read and the write. The insert goes through
          // the table definition rather than raw SQL because `persons.id` and `persons.created_at`
          // are `$defaultFn` generators that only the insert BUILDER runs. The generated DDL says
          // `id text PRIMARY KEY NOT NULL` (`packages/identity/drizzle/0000_baseline.sql:46`), so a
          // raw insert that omits it is refused `NOT NULL constraint failed: persons.id`, errcode
          // 1299 — run on node:sqlite, Node v26.7.0, with the same insert supplying an id as the
          // control, which succeeds.
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
              // The login comparison folds accents and case the same way the index does, so a
              // row stored without its folded twin falls back on an ASCII-only key and an
              // address with a non-ASCII character would stop matching at sign-in. This is the
              // admin account, so it is the one row where that matters most.
              emailFolded: action.email === undefined ? undefined : foldForUniqueness(action.email),
              displayNameFolded: foldForUniqueness(action.displayName),
              role: "admin",
            });
          }
          break;
        }
        case "seed-device-profiles":
          // Non-fiscal. Seed the venue's starter device profiles under an admin management session —
          // the SAME store path the management dashboard uses (createDeviceProfile), so its
          // capability validation and the `till.configure` gate run here too. seed-admin must have run
          // first (the admin is the only person who can open that session); a hand-built plan that
          // runs this before seed-admin is refused as a plan-integrity error, mirroring the ordering
          // guards below. Idempotent: find-or-create by name, so a same-venue re-run adds no
          // duplicate (profiles belong to the tenant, not a shop). Runs on the caller's own
          // transaction. Exercised by `venue-apply.test.ts`:
          // the three seeded profiles, the re-run that adds no duplicates, and the refusal when a
          // plan runs this before seed-admin.
          await seedDeviceProfiles(tx, action.profiles);
          break;
        case "create-location": {
          // `day_cutover` needed a `::text` cast on PostgreSQL, where it was a `time` and came back
          // as one; the column is text on this engine and the cast is a syntax error
          // (`unrecognized token: ":"`). `invoice_locales` needs the builder for a different
          // reason: it is a JSON-encoded list now, so the raw read returned the string
          // `["es-ES"]` where the comparison below wants the array.
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
          // The hand-built `array[$n, …]::text[]` literal this used to carry belonged to a `text[]`
          // column. `invoice_locales` is JSON text now, so the builder encodes the list.
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
          // KDS-1: seed this location's DEFAULT kitchen station so a context-less legacy order has a
          // fallback. Service-context orders use explicit preparation routes instead. Spec §2a ("one
          // default") + §2b: a location with NO default station makes legacy firing a fail-loud
          // `station.no_default` misconfiguration, so a fresh venue must ship one. The owner inserts it
          // in the location's transaction. The operator can rename it later via updateStation;
          // `station.no_default` then guards any venue
          // left with no ACTIVE default station — including one whose sole default was DEACTIVATED
          // (fireLines' fallback requires `is_default AND active`) — not a fresh venue, which always ships
          // this one.
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
          // planVenue always emits create-location first, so `locationId` is set here. A malformed
          // or future-planner plan that runs create-till early would insert an EMPTY location_id — a
          // low-signal 22P02 (invalid uuid). Refuse it as a plan-integrity error instead. A plain
          // Error, NOT an operator-facing AppError code: this is a programming/plan bug, not input.
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
          // As create-till: create-node before create-location would insert an empty location_id.
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
          // A seed before create-node would run against an EMPTY node id; refuse it as a plan-integrity
          // error like the other ordering guards.
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
          // create-series before create-node would insert an empty node_id.
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
          // Push ONLY when a row was actually inserted. `ON CONFLICT DO NOTHING` returns no rows on
          // a collision, and returning the un-inserted id would put a PHANTOM id in the result — a
          // row that does not exist. planVenue now rejects equal standard/rectificative codes
          // up front, so a valid plan never collides here; this keeps VenueResult honest even for a
          // hand-built plan that does (exercised by venue-apply.test.ts).
          if (inserted.length > 0) seriesIds.push(seriesId);
          break;
        }
      }
    }

    // Completeness guards for ids the ordering guards above cannot cover. Those guards only fire when
    // a DEPENDENT action runs, so a plan that omits create-node (and therefore every seed and series
    // that depends on it) reaches here with an empty nodeId, and a plan that omits create-till reaches
    // here with an empty tillId — nothing downstream reads it at all. Either way the venue would be
    // returned as "complete" with an empty id: a node that files nothing, or a shop that cannot sell
    // (recordSale needs a real till). Named here rather than left to fail confusingly later. Plain
    // Errors, NOT operator-facing AppError codes: a plan bug, not input.
    if (nodeId === "") throw new Error("applyVenue: plan is missing create-node");
    if (tillId === "") throw new Error("applyVenue: plan is missing create-till");
    const result = { locationId, tillId, nodeId, seriesIds, seeded };
    await deps.beforeCommit?.(tx, result);
    return result;
  });
}

/**
 * Seed the venue's starter device profiles idempotently (find-or-create by name). Looks up the admin
 * seed-admin created — the only person who can open a `till.configure` management session the store's
 * `createDeviceProfile` authorises against — opens one, and creates each missing profile with
 * `canvasId: null` (→ the form-factor default canvas at runtime). Names + capabilities are already
 * resolved by the planner. Runs on the caller's tx.
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
  // Find-or-create is NAME-based, so idempotency is scoped to a SAME-LOCALE, same-names re-provision: a
  // different-locale re-run would seed a second, differently-named set, and an owner who renamed a
  // seeded profile would have it re-created. Acceptable because profiles are owner-editable AND the
  // double-provision latch makes a re-provision unreachable in practice.
  const existing = new Set((await listDeviceProfiles(tx)).map((p) => p.name));
  const toCreate = profiles.filter((p) => !existing.has(p.name));
  if (toCreate.length === 0) return; // a re-provision whose profiles all exist: nothing to do

  // The admin seed-admin created (role='admin') authors the profiles; a plan that reaches here without
  // one ran seed-device-profiles before seed-admin — a plan-integrity bug, refused like the ordering
  // guards in the apply loop.
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
      managementSessionId: session.id,
      name: profile.name,
      formFactor: profile.formFactor,
      canvasId: null,
      capabilities: profile.capabilities,
      inactivityTimeoutSeconds: profile.inactivityTimeoutSeconds,
    });
  }
}
