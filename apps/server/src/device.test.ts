import { createHash, randomBytes, randomUUID } from "node:crypto";
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
import {
  bindingFkField,
  encodePairingCode,
  enrolDevice,
  generatePairingCode,
  kindRequiresStation,
  kindRequiresTill,
  normalizePairingCode,
} from "./device.js";
import "./errors.js";

// PGlite, not real Postgres, for the SEQUENTIAL crypto/round-trip properties here — generate a code,
// enrol a device, verify the scrypt token, reject an unknown/consumed/expired code. None of these has a
// privilege or concurrency dimension: `app_user`'s grants on device_pairing_codes and devices are pinned
// by the privilege matrix in packages/fiscal-verifactu, the schema's CHECKs and unique index by
// packages/db's devices.test.ts, and the SINGLE-USE RACE — the one property PGlite would FALSE-PASS,
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

  it("mints a station-less handheld pairing code (no requireLiveStation, station_id NULL)", async () => {
    // A handheld is a roving, location-wide waiter device (spec §D2): it binds no kitchen station, so
    // generatePairingCode must NOT call requireLiveStation and must store station_id = NULL. The Task-1
    // CHECK ((device_kind = 'handheld' AND station_id IS NULL)) would reject any non-null station here.
    // It IS sale-capable, so it carries a till_id (SP-A.2 §16.4) — the seeded till.
    const cfg = await setupVenue();
    const { code } = await asApp(cfg, (tx) =>
      generatePairingCode(tx, cfg, {
        kind: "handheld",
        stationId: null,
        tillId: cfg.tillId,
        label: "Waiter phone",
      }),
    );
    const codeSha256 = createHash("sha256").update(code).digest("hex");
    const { rows } = await db.execute<{ device_kind: string; station_id: string | null }>(
      sql`select device_kind, station_id from device_pairing_codes where code_sha256 = ${codeSha256}`,
    );
    expect(rows[0]!.device_kind).toBe("handheld");
    expect(rows[0]!.station_id).toBeNull();
  });

  it("rejects a kds_station pairing code minted with no station (device.station_required)", async () => {
    // A kds_station code REQUIRES a station: a NULL one is a validation failure — `device.station_required`,
    // before any write. Distinct from the `station.not_found` requireLiveStation raises for a station that
    // WAS supplied but is unknown/foreign/retired (that code echoes the supplied uuid; there is none here).
    const cfg = await setupVenue();
    await expect(
      asApp(cfg, (tx) =>
        generatePairingCode(tx, cfg, { kind: "kds_station", stationId: null, label: "X" }),
      ),
    ).rejects.toMatchObject({ code: "device.station_required" });
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

  it("enrols when the operator types the code in lowercase (normalized before lookup)", async () => {
    // The redemption is lenient regardless of the caller: enrolDevice normalizes the typed code FIRST,
    // so a code typed back in lowercase still hashes to the canonical SHA-256 the row was stored under.
    const cfg = await setupVenue();
    const st = await asApp(cfg, (tx) =>
      createStation(tx, cfg, { name: "Cocina", isDefault: true }),
    );
    const { code } = await asApp(cfg, (tx) =>
      generatePairingCode(tx, cfg, { kind: "kds_station", stationId: st.id, label: "x" }),
    );
    const dev = await asApp(cfg, (tx) => enrolDevice(tx, cfg, { code: code.toLowerCase() }));
    expect(dev.stationId).toBe(st.id);
  });
});

describe("normalizePairingCode", () => {
  it("is the identity on any code the encoder emits (round-trip)", () => {
    // A code the operator typed exactly as shown must survive normalization unchanged — so redemption of
    // the canonical string is never altered. Every encoder output is uppercase, alphabet-only and
    // separator-free, i.e. already canonical.
    for (const bytes of [
      Buffer.from([0, 0, 0, 0, 0]),
      Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff]),
      Buffer.from([0x01, 0x23, 0x45, 0x67, 0x89]),
      randomBytes(5),
      randomBytes(5),
    ]) {
      const canonical = encodePairingCode(bytes);
      expect(normalizePairingCode(canonical)).toBe(canonical);
    }
  });

  it("is lenient about case, the ambiguous letters I/L/O, spaces and hyphens", () => {
    // INJECTIVITY: the Crockford alphabet excludes I, L, O and U, so mapping I/L → 1 and O → 0 only ever
    // rewrites a character the encoder NEVER emits. It therefore cannot merge two distinct real codes —
    // leniency here is not a security regression.
    expect(normalizePairingCode("abcdefgh")).toBe("ABCDEFGH"); // case
    expect(normalizePairingCode("O0O0O0O0")).toBe("00000000"); // O → 0
    expect(normalizePairingCode("ILILILIL")).toBe("11111111"); // I / L → 1
    expect(normalizePairingCode("ilILoO09")).toBe("11110009"); // mixed, all lenient rules at once
    expect(normalizePairingCode("ABCD-EFGH")).toBe("ABCDEFGH"); // hyphen stripped
    expect(normalizePairingCode("ABCD EFGH")).toBe("ABCDEFGH"); // space stripped
    expect(normalizePairingCode("  ab-cd ef-gh ")).toBe("ABCDEFGH"); // combined
  });
});

describe("kindRequiresStation", () => {
  it("only kds_station binds a station; handheld and till carry none", () => {
    // The code-side twin of the per-kind station CHECK. A kds_station is an always-on screen tied to
    // one station; a handheld is a roving, location-wide waiter device and a till is a first-class till
    // device that rings sales under its node's SIF (spec §16) — neither binds a station.
    expect(kindRequiresStation("kds_station")).toBe(true);
    expect(kindRequiresStation("handheld")).toBe(false);
    expect(kindRequiresStation("till")).toBe(false);
  });
});

describe("bindingFkField", () => {
  // The 23503 → field accessor, exercised with CRAFTED errors (no DB) so every branch is covered: the
  // `tables.ts` `isZoneFkViolation` / `uniqueViolationConstraint` idiom. The end-to-end 23503 translation
  // is proven against real Postgres in device.rls.test.ts; here we pin the constraint-name mapping and
  // the deliberate NON-matches (a different constraint, a different SQLSTATE, no constraint name).
  const fk = (constraint: string): Error =>
    Object.assign(new Error("fk"), { code: "23503", constraint });

  it("maps each device-binding composite FK's constraint name to its input field", () => {
    expect(bindingFkField(fk("device_pairing_codes_till_fk"))).toBe("tillId");
    expect(bindingFkField(fk("device_pairing_codes_receipt_printer_fk"))).toBe("receiptPrinterId");
    // The device-profile composite FKs (device-profile design 2026-09-05): one on `device_pairing_codes`
    // (mint time) and its twin on `devices` (tripped when a device is REASSIGNED to a device profile that
    // names no row of this tenant, via the assign-device-profile route). Both → `deviceProfileId`. Since
    // the Task 10 cutover this is the ONLY reassign binding — the direct device→canvas FK was dropped.
    expect(bindingFkField(fk("device_pairing_codes_device_profile_fk"))).toBe("deviceProfileId");
    expect(bindingFkField(fk("devices_device_profile_fk"))).toBe("deviceProfileId");
  });

  it("returns undefined for the dropped device→canvas composite FKs (Task 10 cutover)", () => {
    // The direct device→canvas binding (and its `assign-canvas` route) was removed in the Task 10 cutover,
    // so the old constraint names no longer map to a field — a 23503 on one would rethrow raw. (A bad
    // profile canvas reference is now `device_profile.invalid`, translated in the device-profile store.)
    expect(bindingFkField(fk("device_pairing_codes_canvas_fk"))).toBeUndefined();
    expect(bindingFkField(fk("devices_canvas_fk"))).toBeUndefined();
  });

  it("finds the 23503 wrapped in a DrizzleQueryError-style cause chain", () => {
    const wrapped = new Error("outer", {
      cause: new Error("mid", { cause: fk("device_pairing_codes_till_fk") }),
    });
    expect(bindingFkField(wrapped)).toBe("tillId");
  });

  it("returns undefined for a 23503 on a NON-binding constraint (rethrown raw, not mislabelled)", () => {
    // A 23503 on the direct tenant/location FKs is not a binding fault — the catch rethrows it raw.
    expect(bindingFkField(fk("device_pairing_codes_location_id_locations_id_fk"))).toBeUndefined();
  });

  it("returns undefined when the 23503 carries no constraint name (PGlite may omit it)", () => {
    expect(bindingFkField(Object.assign(new Error("fk"), { code: "23503" }))).toBeUndefined();
  });

  it("returns undefined for a non-23503 error, a self-referential cause loop, and nullish input", () => {
    expect(bindingFkField(Object.assign(new Error("dup"), { code: "23505" }))).toBeUndefined();
    const looped: { code?: string; cause?: unknown } = {};
    looped.cause = looped; // a self-referential cause must not spin forever
    expect(bindingFkField(looped)).toBeUndefined();
    expect(bindingFkField(null)).toBeUndefined();
    expect(bindingFkField(undefined)).toBeUndefined();
  });
});

describe("kindRequiresTill", () => {
  it("the sale-capable kinds (till, handheld) require a till; kds_station carries none", () => {
    // The code-side twin of the per-kind `device.till_required` gate (SP-A.2 §16.4). A till and a
    // handheld both ring sales under their node's SIF and must name the tills row they file against; a
    // kds_station rings no sale and must name none. Deliberately the complement of kindRequiresStation
    // TODAY, but a separate predicate (a future kind need not preserve that coincidence).
    expect(kindRequiresTill("till")).toBe(true);
    expect(kindRequiresTill("handheld")).toBe(true);
    expect(kindRequiresTill("kds_station")).toBe(false);
  });
});
