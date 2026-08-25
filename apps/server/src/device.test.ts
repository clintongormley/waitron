import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { verifySecret } from "@waitron/identity";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { createStation } from "./kitchen.js";
import { enrolDevice, generatePairingCode } from "./device.js";
import "./errors.js";

// PGlite, not real Postgres, for the SEQUENTIAL crypto/round-trip properties here — generate a code,
// enrol a device, verify the scrypt token, reject an unknown/consumed/expired code. None of these has a
// privilege or concurrency dimension: the FORCE-RLS grants (SELECT/INSERT/DELETE on device_pairing_codes,
// SELECT/INSERT/UPDATE on devices) are already proven against real Postgres in packages/db's
// devices.rls.test.ts (Task 1), and the SINGLE-USE RACE — the one property PGlite would FALSE-PASS,
// because it serialises every query onto one backend — lives in device.rls.test.ts against real Postgres
// (CLAUDE.md §4). So PGlite is the correct lighter target for this file, the same choice kitchen.test.ts
// makes for the station-config verbs.
const LOCALE = "es-ES";
const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let db: Database;
beforeAll(() => {
  db = suite.db;
});

async function setupVenue(): Promise<TillConfig> {
  const tenantId = await seedTenant(db);
  const loc = await db.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenantId}, 'Barra', array[${LOCALE}], 'Venta en establecimiento') returning id`);
  const locationId = loc.rows[0]!.id;
  const till = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name) values (${tenantId}, ${locationId}, 'Caja 1') returning id`);
  const nodeId = await seedNode(db, tenantId, brandLocationId(locationId));
  return {
    tenantId,
    tillId: brandTillId(till.rows[0]!.id),
    nodeId: brandNodeId(nodeId),
    seriesId: brandSeriesId(randomUUID()),
    locationId: brandLocationId(locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

function asApp<T>(cfg: TillConfig, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    return fn(tx);
  });
}

/** Read the enrolled device's `token_hash` as the superuser (RLS bypassed) — the load-bearing check
 * for the round-trip is that the stored hash verifies the raw token and is NOT the plaintext. */
async function deviceRow(deviceId: string): Promise<{ tokenHash: string }> {
  const { rows } = await db.execute<{ token_hash: string }>(
    sql`select token_hash from devices where id = ${deviceId}`,
  );
  return { tokenHash: rows[0]!.token_hash };
}

/** How many pairing codes this tenant still holds — used to prove the expired-code DELETE is rolled
 * back (the code survives to lapse by its TTL rather than being burned). */
async function pairingCodeCount(cfg: TillConfig): Promise<number> {
  const { rows } = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from device_pairing_codes where tenant_id = ${cfg.tenantId}`,
  );
  return rows[0]!.n;
}

/** Backdate this tenant's pairing codes past PAIRING_TTL_MS. Run as the superuser db connection:
 * `app_user` holds no UPDATE on device_pairing_codes (a code is consumed, never edited), and a
 * superuser bypasses RLS, so this pure test-setup mutation cannot go through the app role. */
async function expirePairingCodes(cfg: TillConfig): Promise<void> {
  await db.execute(
    sql`update device_pairing_codes set created_at = now() - interval '16 minutes'
        where tenant_id = ${cfg.tenantId}`,
  );
}

describe("device pairing-code generation + enrolment", () => {
  it("generates a code, enrols a device, and mints a verifiable token", async () => {
    const cfg = await setupVenue();
    const st = await asApp(cfg, (tx) =>
      createStation(tx, cfg, { name: "Cocina", isDefault: true }),
    );
    const { code } = await asApp(cfg, (tx) =>
      generatePairingCode(tx, cfg, { kind: "kds_station", stationId: st.id, label: "Pantalla" }),
    );
    // The code is a high-entropy 8-char Crockford-base32 string (≈40 bits), NOT a 6-digit PIN, and the
    // Crockford alphabet excludes I/L/O/U so it is human-typeable off one screen onto another.
    expect(code).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);

    const dev = await asApp(cfg, (tx) => enrolDevice(tx, cfg, { code }));
    expect(dev).toMatchObject({ kind: "kds_station", stationId: st.id, label: "Pantalla" });

    const row = await deviceRow(dev.deviceId);
    expect(verifySecret(dev.token, row.tokenHash)).toBe(true); // scrypt round-trip
    expect(row.tokenHash).not.toContain(dev.token); // never plaintext at rest
  });

  it("rejects an unknown / already-consumed code with device.pairing_invalid", async () => {
    const cfg = await setupVenue();
    const st = await asApp(cfg, (tx) =>
      createStation(tx, cfg, { name: "Cocina", isDefault: true }),
    );
    // Unknown: a well-formed-looking code that redeemed no row.
    await expect(
      asApp(cfg, (tx) => enrolDevice(tx, cfg, { code: "BADCODE9" })),
    ).rejects.toMatchObject({ code: "device.pairing_invalid" });
    // Single-use: enrolling consumes the code (the locking DELETE), so a second redeem finds nothing.
    const { code } = await asApp(cfg, (tx) =>
      generatePairingCode(tx, cfg, { kind: "kds_station", stationId: st.id, label: "x" }),
    );
    await asApp(cfg, (tx) => enrolDevice(tx, cfg, { code })); // consumes it
    await expect(asApp(cfg, (tx) => enrolDevice(tx, cfg, { code }))).rejects.toMatchObject({
      code: "device.pairing_invalid",
    });
  });

  it("rejects an expired code with device.pairing_expired and leaves the code intact (rolled back)", async () => {
    const cfg = await setupVenue();
    const st = await asApp(cfg, (tx) =>
      createStation(tx, cfg, { name: "Cocina", isDefault: true }),
    );
    const { code } = await asApp(cfg, (tx) =>
      generatePairingCode(tx, cfg, { kind: "kds_station", stationId: st.id, label: "x" }),
    );
    await expirePairingCodes(cfg); // now - created_at > PAIRING_TTL_MS
    await expect(asApp(cfg, (tx) => enrolDevice(tx, cfg, { code }))).rejects.toMatchObject({
      code: "device.pairing_expired",
    });
    // The WebAuthn semantic: the throw rolls back the tx, UNDOING the consume-DELETE, so the code
    // survives to lapse by its TTL rather than being burned by a too-late attempt.
    expect(await pairingCodeCount(cfg)).toBe(1);
  });

  it("generatePairingCode rejects a station of another venue / an unknown station with station.not_found", async () => {
    // Reuses kitchen.ts's requireLiveStation: a code can only ever be minted against a LIVE station of
    // this venue, so a device cannot be bound to a station the venue does not own.
    const cfg = await setupVenue();
    const missing = randomUUID();
    await expect(
      asApp(cfg, (tx) =>
        generatePairingCode(tx, cfg, { kind: "kds_station", stationId: missing, label: "x" }),
      ),
    ).rejects.toMatchObject({ code: "station.not_found", params: { stationId: missing } });
  });
});
