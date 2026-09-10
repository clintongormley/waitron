// Seed the floor plan and service statuses in the caller's transaction.
// toTableCfg brands the supplied venue ids for the table operations.
// Statuses are inserted directly because the management helper requires a session.

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import { createTable, createZone, setTablePlacement } from "../../src/tables.js";
import type { TillConfig } from "../../src/till-config.js";
import { DEMO_STATUSES, DEMO_TABLES, DEMO_ZONES } from "./floor.js";
import { SEED_INVOICE_LOCALE, type SeedLocale } from "./menu.js";

export interface SeedFloorInput {
  tenantId: string;
  locationId: string;
  locale: SeedLocale;
  menuIds?: string[];
}

/**
 * Bridge the plain-string venue ids `applyVenue` returns into the branded `TillConfig` shape
 * `createZone`/`createTable`/`setTablePlacement` are typed to take. Only `tenantId`/`locationId` are
 * ever READ by those three (confirmed by inspection of `apps/server/src/tables.ts`: `createZone`/
 * `createTable` insert `cfg.tenantId`/`cfg.locationId` as literal column values, and
 * `setTablePlacement` reads `cfg.locationId` alone to scope its lookups) — every other field here is
 * a placeholder that satisfies the type and is never touched, the same shape `tables.test.ts`'s own
 * `setupVenue` fixture uses for its unrelated `seriesId` (a random uuid, no real series row).
 */
function toTableCfg(tenantId: string, locationId: string, locale: SeedLocale): TillConfig {
  return {
    tenantId: brandTenantId(tenantId),
    tillId: brandTillId(randomUUID()),
    nodeId: brandNodeId(randomUUID()),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    // `locale` is the BARE content key; the fiscal/display fields take the FULL tag it files under.
    // Both are placeholders here (only tenantId/locationId are read — see this function's doc), kept
    // full-tag so the throwaway cfg is a VALID `TillConfig` shape rather than a bare-locale one.
    locale: SEED_INVOICE_LOCALE[locale],
    invoiceLocales: [SEED_INVOICE_LOCALE[locale]],
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

/**
 * Seed the floor plan onto `locationId` under the caller's tenant context: the three zones
 * (Comedor/Terraza/Barra), ~16 placed tables, and the four service statuses. Zones are created
 * before any table (a table's `zoneId` must name a LIVE zone of this location — `setTablePlacement`
 * enforces it, `zone.not_found` otherwise), and each table is placed (`setTablePlacement`)
 * immediately after it is created.
 */
export async function seedFloor(
  tx: Transaction,
  { tenantId, locationId, locale, menuIds = [] }: SeedFloorInput,
): Promise<void> {
  const cfg = toTableCfg(tenantId, locationId, locale);

  const { rows: defaults } = await tx.execute<{ department_id: string; zone_id: string }>(sql`
    select department_id, zone_id from zone_service_policies
    where tenant_id = ${tenantId} and location_id = ${locationId} and is_counter_default
    limit 1`);
  const defaultPolicy = defaults[0];
  if (defaultPolicy === undefined) {
    throw new Error(`seedFloor: no default service zone for location ${locationId}`);
  }

  const zoneIds = new Map<string, string>();
  for (const zone of DEMO_ZONES) {
    const zoneId =
      zone.key === "bar"
        ? defaultPolicy.zone_id
        : (
            await createZone(tx, cfg, {
              name: zone.name[locale],
              displayOrder: zone.displayOrder,
            })
          ).id;
    if (zone.key === "bar") {
      await tx.execute(sql`
        update floor_zones set name = ${zone.name[locale]}, display_order = ${zone.displayOrder}
        where tenant_id = ${tenantId} and id = ${zoneId}`);
    } else {
      await tx.execute(sql`
        insert into zone_service_policies
          (tenant_id, location_id, zone_id, department_id, service_mode, is_counter_default)
        values (
          ${tenantId}, ${locationId}, ${zoneId}, ${defaultPolicy.department_id}, null, false
        )`);
    }
    for (const [index, menuId] of menuIds.entries()) {
      await tx.execute(sql`
        insert into zone_menus (tenant_id, zone_id, menu_id, display_order)
        values (${tenantId}, ${zoneId}, ${menuId}, ${index})
        on conflict (tenant_id, zone_id, menu_id)
        do update set display_order = excluded.display_order`);
      if (index === 0) {
        await tx.execute(sql`
          update zone_service_policies set default_menu_id = ${menuId}
          where tenant_id = ${tenantId} and zone_id = ${zoneId}`);
      }
    }
    zoneIds.set(zone.key, zoneId);
  }

  for (const table of DEMO_TABLES) {
    const zoneId = zoneIds.get(table.zoneKey);
    if (zoneId === undefined) {
      throw new Error(`seedFloor: no zone seeded for key "${table.zoneKey}"`);
    }
    const created = await createTable(tx, cfg, {
      label: table.label,
      zoneId,
      capacity: table.capacity,
    });
    await setTablePlacement(tx, cfg, created.id, {
      zoneId,
      posX: table.posX,
      posY: table.posY,
      shape: table.shape,
      rotation: table.rotation,
    });
  }

  for (const [index, status] of DEMO_STATUSES.entries()) {
    await tx.execute(
      sql`insert into table_service_statuses (tenant_id, label, color, display_order)
          values (${tenantId}, ${status.label[locale]}, ${status.color}, ${index})`,
    );
  }
}
