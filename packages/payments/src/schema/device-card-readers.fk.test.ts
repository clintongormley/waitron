import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asAppUser, captureError, pgErrorCode, withTenant } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { freshNif } from "../../test/seed.js";
import { cardReaders } from "./card-readers.js";
import { deviceCardReaders } from "./device-card-readers.js";

// Real Postgres, not PGlite: this suite doubles as the grant check (CLAUDE.md §4), writing under
// app_user's grants (`asAppUser`) so a missing SELECT/INSERT/UPDATE/DELETE grant from
// 0006_device_card_readers_sql.sql fails here. A clone of the `core_payments` template (CORE + PAYMENTS).
const postgres = useTemplateDb({ template: "core_payments" });

interface Seeded {
  tenantId: string;
  deviceId: string;
  readerId: string;
}

/**
 * Seeds one tenant with a location, a `till`-form-factor device profile, a till, one device bound
 * to that till, and one card reader — everything device_card_readers' three composite FKs
 * (tenant, tenant+device, tenant+reader) need a real row to point at.
 */
async function seedDeviceAndReader(db: Database): Promise<Seeded> {
  const t = await db.execute<{ id: string }>(sql`
    insert into tenants (country, tax_id, legal_name)
    values ('ES', ${freshNif()}, 'Test SL') returning id`);
  const tenantId = t.rows[0]!.id;
  const l = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Counter', array['es'], 'Hostelería') returning id`);
  const locationId = l.rows[0]!.id;
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Till 1') returning id`);
  const tillId = till.rows[0]!.id;
  const profile = await db.execute<{ id: string }>(sql`
    insert into device_profiles (tenant_id, name, form_factor)
    values (${tenantId}, 'Profile', 'till') returning id`);
  const profileId = profile.rows[0]!.id;
  const device = await db.execute<{ id: string }>(sql`
    insert into devices (tenant_id, location_id, device_profile_id, till_id, label, token_hash)
    values (${tenantId}, ${locationId}, ${profileId}, ${tillId}, 'Counter till', 'scrypt$00$00') returning id`);
  const deviceId = device.rows[0]!.id;
  const reader = await db
    .insert(cardReaders)
    .values({ tenantId, provider: "sumup", providerRef: `rdr_${deviceId}`, name: "Counter" })
    .returning({ id: cardReaders.id });
  return { tenantId, deviceId, readerId: reader[0]!.id };
}

describe("device_card_readers", () => {
  it("stores a device's default reader, round-trips, and a delete clears the default", async () => {
    const db = postgres.admin;
    const { tenantId, deviceId, readerId } = await seedDeviceAndReader(db);

    await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      await tx.insert(deviceCardReaders).values({ tenantId, deviceId, readerId });
    });

    const stored = await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      return tx.select().from(deviceCardReaders).where(eq(deviceCardReaders.deviceId, deviceId));
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.readerId).toBe(readerId);
    expect(stored[0]!.tenantId).toBe(tenantId);

    // The mapping is mutable — DELETE clears the device's default (unlike an append-only ledger).
    await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      await tx
        .delete(deviceCardReaders)
        .where(
          and(eq(deviceCardReaders.tenantId, tenantId), eq(deviceCardReaders.deviceId, deviceId)),
        );
    });
    const afterDelete = await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      return tx.select().from(deviceCardReaders).where(eq(deviceCardReaders.deviceId, deviceId));
    });
    expect(afterDelete).toHaveLength(0);
  });

  it("rejects a second default reader for the same device (PK tenant_id, device_id)", async () => {
    const db = postgres.admin;
    const { tenantId, deviceId, readerId } = await seedDeviceAndReader(db);
    const reader2 = await db
      .insert(cardReaders)
      .values({
        tenantId,
        provider: "sumup",
        providerRef: `rdr_second_${deviceId}`,
        name: "Second",
      })
      .returning({ id: cardReaders.id });

    await withTenant(db, tenantId, async (tx) => {
      await asAppUser(tx);
      await tx.insert(deviceCardReaders).values({ tenantId, deviceId, readerId });
    });

    const dup = await captureError(() =>
      withTenant(db, tenantId, async (tx) => {
        await asAppUser(tx);
        await tx.insert(deviceCardReaders).values({ tenantId, deviceId, readerId: reader2[0]!.id });
      }),
    );
    expect(pgErrorCode(dup)).toBe("23505"); // unique_violation (the PK)
  });

  it("rejects a reader naming a DIFFERENT tenant (composite FK)", async () => {
    const db = postgres.admin;
    const a = await seedDeviceAndReader(db);
    const b = await seedDeviceAndReader(db);

    const e = await captureError(() =>
      withTenant(db, a.tenantId, async (tx) => {
        await asAppUser(tx);
        await tx
          .insert(deviceCardReaders)
          .values({ tenantId: a.tenantId, deviceId: a.deviceId, readerId: b.readerId });
      }),
    );
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation
  });

  it("rejects a device naming a DIFFERENT tenant (composite FK)", async () => {
    const db = postgres.admin;
    const a = await seedDeviceAndReader(db);
    const b = await seedDeviceAndReader(db);

    const e = await captureError(() =>
      withTenant(db, a.tenantId, async (tx) => {
        await asAppUser(tx);
        await tx
          .insert(deviceCardReaders)
          .values({ tenantId: a.tenantId, deviceId: b.deviceId, readerId: a.readerId });
      }),
    );
    expect(pgErrorCode(e)).toBe("23503"); // foreign_key_violation
  });
});
