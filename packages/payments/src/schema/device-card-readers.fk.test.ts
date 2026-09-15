import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { asAppUser, captureError, pgErrorCode, pgErrorMessage, withTransaction } from "@waitron/db";
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
  deviceId: string;
  readerId: string;
}

/**
 * Seeds a location, a `till`-form-factor device profile, a till, one device bound to that till, and
 * one card reader — the rows device_card_readers' device and reader FKs point at.
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
    .values({ provider: "sumup", providerRef: `rdr_${deviceId}`, name: "Counter" })
    .returning({ id: cardReaders.id });
  return { deviceId, readerId: reader[0]!.id };
}

describe("device_card_readers", () => {
  it("stores a device's default reader, round-trips, and a delete clears the default", async () => {
    const db = postgres.admin;
    const { deviceId, readerId } = await seedDeviceAndReader(db);

    await withTransaction(db, async (tx) => {
      await asAppUser(tx);
      await tx.insert(deviceCardReaders).values({ deviceId, readerId });
    });

    const stored = await withTransaction(db, async (tx) => {
      await asAppUser(tx);
      return tx.select().from(deviceCardReaders).where(eq(deviceCardReaders.deviceId, deviceId));
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.readerId).toBe(readerId);

    // The mapping is mutable — DELETE clears the device's default (unlike an append-only ledger).
    await withTransaction(db, async (tx) => {
      await asAppUser(tx);
      await tx.delete(deviceCardReaders).where(eq(deviceCardReaders.deviceId, deviceId));
    });
    const afterDelete = await withTransaction(db, async (tx) => {
      await asAppUser(tx);
      return tx.select().from(deviceCardReaders).where(eq(deviceCardReaders.deviceId, deviceId));
    });
    expect(afterDelete).toHaveLength(0);
  });

  it("rejects a second default reader for the same device (PK device_id)", async () => {
    const db = postgres.admin;
    const { deviceId, readerId } = await seedDeviceAndReader(db);
    const reader2 = await db
      .insert(cardReaders)
      .values({
        provider: "sumup",
        providerRef: `rdr_second_${deviceId}`,
        name: "Second",
      })
      .returning({ id: cardReaders.id });

    await withTransaction(db, async (tx) => {
      await asAppUser(tx);
      await tx.insert(deviceCardReaders).values({ deviceId, readerId });
    });

    const dup = await captureError(() =>
      withTransaction(db, async (tx) => {
        await asAppUser(tx);
        await tx.insert(deviceCardReaders).values({ deviceId, readerId: reader2[0]!.id });
      }),
    );
    expect(pgErrorCode(dup)).toBe("23505"); // unique_violation (the PK)
  });

  it("refuses a device or a reader that does not exist", async () => {
    const db = postgres.admin;
    const { deviceId, readerId } = await seedDeviceAndReader(db);
    const noDevice = await captureError(() =>
      withTransaction(db, async (tx) => {
        await asAppUser(tx);
        await tx.insert(deviceCardReaders).values({ deviceId: randomUUID(), readerId });
      }),
    );
    expect(pgErrorCode(noDevice)).toBe("23503"); // foreign_key_violation
    expect(pgErrorMessage(noDevice)).toMatch(/device_card_readers_device_fk/);
    const noReader = await captureError(() =>
      withTransaction(db, async (tx) => {
        await asAppUser(tx);
        await tx.insert(deviceCardReaders).values({ deviceId, readerId: randomUUID() });
      }),
    );
    expect(pgErrorCode(noReader)).toBe("23503");
    expect(pgErrorMessage(noReader)).toMatch(/device_card_readers_reader_fk/);
  });
});
