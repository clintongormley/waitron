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
  { tenantId, locationId, locale }: SeedFloorInput,
): Promise<void> {
  const cfg = toTableCfg(tenantId, locationId, locale);

  const zoneIds = new Map<string, string>();
  for (const zone of DEMO_ZONES) {
    const created = await createZone(tx, cfg, {
      name: zone.name[locale],
      displayOrder: zone.displayOrder,
    });
    zoneIds.set(zone.key, created.id);
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
