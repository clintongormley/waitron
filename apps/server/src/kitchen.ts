// Side-effect only: keeps this host's `station.*` codes (errors.ts) reachable from the file that throws
// them — the reachability convention tables.ts/till-sale.ts follow. See errors.ts.
import "./errors.js";
import { and, eq, sql } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { categories, isUniqueViolation, kitchenStations, products } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { TillConfig } from "./till-config.js";

// KDS-1 (design §3a) station config + routing verbs. Config only — plain inserts / by-id UPDATEs on the
// caller's transaction under its tenant/app_user scope; the `till.configure` gate is applied at the ROUTE
// layer (Task 7, the layout-routes model), exactly as the FP-1 zone/table verbs in tables.ts rely on RLS
// + the route's authorizeManager rather than gating inside the verb. Deliberately imports nothing from
// working-order.ts — the `order_prep` rework (Tasks 3/4/6) leaves that module broken mid-branch.

/** A configured kitchen station as the CRUD surface returns it — the slim shape the config editor and
 *  the station picker both read. `createdAt` is INTERNAL, not part of this surface (the same choice
 *  tables.ts's {@link FloorZone} makes for its own `createdAt`). */
export interface Station {
  id: string;
  name: string;
  displayOrder: number;
  /** The venue's single fallback station (the counter/pass), enforced by the `WHERE is_default` partial
   *  unique. Written only by {@link setDefaultStation} / {@link createStation}, never a plain update. */
  isDefault: boolean;
  active: boolean;
}

/**
 * Assert `stationId` names a LIVE station of THIS venue — present, `active`, and in `cfg.locationId`.
 * NULL-or-false → `station.not_found`, folding "absent / another tenant's (RLS-hidden) / another venue's"
 * and "deactivated" into the one code (errors.ts explains why the inactive case is not distinct). The
 * tenant-consistent `categories_station_fk`/`products_station_fk` (and the default's own scope) enforce
 * only same-TENANT existence — they can see neither `active` nor the location — so this explicit read is
 * what rejects a retired or cross-venue station the FK would accept. One round trip via a scalar subquery,
 * the shape tables.ts's `setTableStatus` uses; RLS confines the read to the tenant, the `location_id`
 * predicate narrows it to this venue.
 */
async function requireLiveStation(
  tx: Transaction,
  cfg: TillConfig,
  stationId: string,
): Promise<void> {
  const { rows } = await tx.execute<{ active: boolean | null }>(
    sql`select (select ${kitchenStations.active} from ${kitchenStations}
      where ${kitchenStations.id} = ${stationId}
        and ${kitchenStations.locationId} = ${cfg.locationId}) as active`,
  );
  if (!rows[0]!.active) {
    throw new AppError("station.not_found", { stationId });
  }
}

/**
 * Clear the venue's current default station (`is_default = false` on the one `is_default` row of
 * `cfg.locationId`, if any). Shared by {@link setDefaultStation} and {@link createStation}: the partial
 * unique `kitchen_stations_default_key` (one default per location) tolerates no two defaults even
 * momentarily, so a new default is always CLEAR-then-SET, and clearing first is what keeps the two from
 * ever coexisting within the statement pair (setting first would trip 23505 at the statement boundary).
 */
async function clearDefault(tx: Transaction, cfg: TillConfig): Promise<void> {
  await tx
    .update(kitchenStations)
    .set({ isDefault: false })
    .where(
      and(eq(kitchenStations.locationId, cfg.locationId), eq(kitchenStations.isDefault, true)),
    );
}

/**
 * Create a kitchen station in the till's venue (its `cfg.locationId`), returning the minted id. A
 * duplicate `(tenant, location, name)` collides on `kitchen_stations_name_key` and is surfaced as
 * `station.name_taken` rather than the raw 23505 — the same shape tables.ts's `createZone` maps
 * `zone.name_taken` with. Marking the station default ADOPTS it as THE default: it clears any prior
 * default first (in this same tx), exactly as {@link setDefaultStation} does. That also keeps the 23505
 * catch UNAMBIGUOUS — with the partial-default unique never reachable on this INSERT, the only unique it
 * can trip is the name key, so a caught 23505 is always a name collision (never mis-mapping a default
 * collision to `station.name_taken`, the receipt discipline CLAUDE.md §1/§3 asks for).
 */
export async function createStation(
  tx: Transaction,
  cfg: TillConfig,
  input: { name: string; displayOrder?: number; isDefault?: boolean },
): Promise<{ id: string }> {
  if (input.isDefault) {
    await clearDefault(tx, cfg);
  }
  try {
    const [row] = await tx
      .insert(kitchenStations)
      .values({
        tenantId: cfg.tenantId,
        locationId: cfg.locationId,
        name: input.name,
        displayOrder: input.displayOrder ?? 0,
        isDefault: input.isDefault ?? false,
      })
      .returning({ id: kitchenStations.id });
    return { id: row!.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError("station.name_taken", { name: input.name });
    }
    throw error;
  }
}

/** The venue's ACTIVE stations, by `display_order` then `name`. RLS confines the read to the tenant; the
 *  location filter narrows to this till's venue — the same active-only, location-scoped shape tables.ts's
 *  {@link listZones} uses (a deactivated station is not a routing/display target). */
export async function listStations(tx: Transaction, cfg: TillConfig): Promise<Station[]> {
  return tx
    .select({
      id: kitchenStations.id,
      name: kitchenStations.name,
      displayOrder: kitchenStations.displayOrder,
      isDefault: kitchenStations.isDefault,
      active: kitchenStations.active,
    })
    .from(kitchenStations)
    .where(and(eq(kitchenStations.locationId, cfg.locationId), eq(kitchenStations.active, true)))
    .orderBy(kitchenStations.displayOrder, kitchenStations.name);
}

/**
 * Edit a station's `name`/`displayOrder`/`active` (any subset) — NOT `is_default`, which only
 * {@link setDefaultStation} may flip (so the partial unique is never risked by a plain update).
 * Reactivation is `updateStation({ active: true })`, the `update`-shaped surface tables.ts's
 * {@link updateZone} uses. An absent id (or another tenant's, RLS-hidden) throws `station.not_found`; a
 * name collision throws `station.name_taken`.
 */
export async function updateStation(
  tx: Transaction,
  // Kept for a uniform `(tx, cfg, …)` verb surface; this by-id update relies on RLS for the tenant
  // scope, so the config is unused here (the repo idiom for an interface-mandated unused param — see
  // tables.ts's updateZone).
  _cfg: TillConfig,
  id: string,
  patch: { name?: string; displayOrder?: number; active?: boolean },
): Promise<void> {
  const set: { name?: string; displayOrder?: number; active?: boolean } = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.displayOrder !== undefined) set.displayOrder = patch.displayOrder;
  if (patch.active !== undefined) set.active = patch.active;

  let updated: { id: string }[];
  try {
    updated = await tx
      .update(kitchenStations)
      .set(set)
      .where(eq(kitchenStations.id, id))
      .returning({ id: kitchenStations.id });
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Only `name` participates in a unique an UPDATE can trip here, so it was necessarily supplied.
      throw new AppError("station.name_taken", { name: patch.name! });
    }
    throw error;
  }
  if (updated.length === 0) {
    throw new AppError("station.not_found", { stationId: id });
  }
}

/** Deactivate a station (`active = false`) — never a hard delete (a `ticket_items.station_id` snapshot
 *  may reference it; app_user holds no DELETE on `kitchen_stations`). An absent id throws
 *  `station.not_found`. `is_default` is left as-is: a deactivated default keeps the slot until another
 *  station is made default (which clears it), and {@link setDefaultStation} refuses a deactivated target,
 *  so no live routing ever lands on it. */
export async function deactivateStation(
  tx: Transaction,
  // Unused here for the same reason as {@link updateStation} — kept for the uniform verb surface.
  _cfg: TillConfig,
  id: string,
): Promise<void> {
  const updated = await tx
    .update(kitchenStations)
    .set({ active: false })
    .where(eq(kitchenStations.id, id))
    .returning({ id: kitchenStations.id });
  if (updated.length === 0) {
    throw new AppError("station.not_found", { stationId: id });
  }
}

/**
 * Make station `id` the venue's single default (the counter/pass fallback). The target must be a LIVE
 * station of this venue (else `station.not_found`, {@link requireLiveStation}) — a retired or foreign
 * station cannot be the fallback, and the check runs BEFORE any write so a bad id never clears the
 * existing default. Then CLEAR the prior default and SET the new one — two statements in the caller's
 * one tx. The partial unique `kitchen_stations_default_key` is checked at each statement boundary, so
 * clearing first means the two defaults never coexist (setting first would trip 23505). Idempotent when
 * `id` is already the default: the clear unsets it, the set restores it.
 */
export async function setDefaultStation(
  tx: Transaction,
  cfg: TillConfig,
  id: string,
): Promise<void> {
  await requireLiveStation(tx, cfg, id);
  await clearDefault(tx, cfg);
  await tx.update(kitchenStations).set({ isDefault: true }).where(eq(kitchenStations.id, id));
}

/**
 * Set (or clear, with `null`) a category's DEFAULT routing station (KDS-1 §2b) — the category-level route
 * a fired line falls to when its product names no override. A non-null `stationId` must be a LIVE station
 * of this venue ({@link requireLiveStation}, `station.not_found` otherwise); clearing (null) skips the
 * check, the shape tables.ts's `setTableStatus` uses for a null status. The UPDATE is by category id under
 * RLS (categories are tenant-wide, no location column): a `categoryId` this tenant does not own matches no
 * row and is a no-op — the route layer (Task 7) resolves category ids against the catalogue surface, and
 * KDS-1 mints no `category.not_found` (spec §6 enumerates only the three `station.*` codes + `ticket.*`).
 */
export async function setCategoryStation(
  tx: Transaction,
  cfg: TillConfig,
  categoryId: string,
  stationId: string | null,
): Promise<void> {
  if (stationId !== null) {
    await requireLiveStation(tx, cfg, stationId);
  }
  await tx.update(categories).set({ stationId }).where(eq(categories.id, categoryId));
}

/**
 * Set (or clear, with `null`) a product's OVERRIDE routing station (KDS-1 §2b) — the per-product route
 * that wins over its category default. Same shape as {@link setCategoryStation}: a non-null `stationId`
 * must be a LIVE station of this venue (`station.not_found` otherwise), null clears it, and the UPDATE is
 * by product id under RLS (a `productId` this tenant does not own is a no-op — the route layer resolves
 * product ids, and KDS-1 mints no `product.not_found`).
 */
export async function setProductStation(
  tx: Transaction,
  cfg: TillConfig,
  productId: string,
  stationId: string | null,
): Promise<void> {
  if (stationId !== null) {
    await requireLiveStation(tx, cfg, stationId);
  }
  await tx.update(products).set({ stationId }).where(eq(products.id, productId));
}

/** The KDS-1 whole-ticket bump mode (§2e). `line` = per-line bump only; `ticket` = the station display
 *  ALSO offers a whole-ticket "bump all". The per-line ticket-item state is always the source of truth;
 *  this flag governs only the display convenience. Mirrors `locations.bump_mode`'s pgEnum
 *  (`packages/db/src/schema/tenants.ts`), spelled as a literal union here because `@waitron/db`'s
 *  enumerated exports do NOT publish the `bumpMode` enum object (CLAUDE.md §3). */
export type BumpMode = "line" | "ticket";

/**
 * Set the venue's whole-ticket bump mode (KDS-1 §2e) — a single per-location flag on `locations.bump_mode`
 * (`line` default / `ticket`), scoped to `cfg.locationId` under RLS. Written via a parameterised `sql`
 * update rather than a Drizzle `.update(locations)` because `@waitron/db`'s enumerated exports map does
 * NOT publish the `locations` table object (CLAUDE.md §3) — the same raw-`sql` shape the `order_flow`
 * flip uses in the till suites. `mode` is a typed `BumpMode`, so the value reaching the enum column is
 * always one of its two members (the route validates the request field before calling); `${mode}` binds
 * as a parameter (never string-concatenated) and PostgreSQL coerces it to the `bump_mode` enum in the
 * assignment context. `till.configure`-gated at the ROUTE (Task 7), as the other config verbs are.
 */
export async function setBumpMode(tx: Transaction, cfg: TillConfig, mode: BumpMode): Promise<void> {
  await tx.execute(sql`update locations set bump_mode = ${mode} where id = ${cfg.locationId}`);
}
