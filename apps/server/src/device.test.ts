import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import {
  bindingFkField,
  encodePairingCode,
  generatePairingCode,
  normalizePairingCode,
} from "./device.js";
import "./errors.js";

// PGlite, not real Postgres, for the SEQUENTIAL crypto/round-trip properties here — generate a code,
// enrol a device, verify the scrypt token, reject an unknown/consumed/expired code. None of these has a
// privilege or concurrency dimension: `app_user`'s grants on device_pairing_codes and devices are pinned
// by the privilege matrix in packages/fiscal-verifactu, the schema's CHECKs and unique index by
// packages/db's devices.test.ts, and the SINGLE-USE RACE — the one property PGlite would FALSE-PASS,
// because it serialises every query onto one backend — lives in device.pg.test.ts against real Postgres
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

// enrolDevice unit tests (round-trip, single-use, TTL, lowercase normalization) live with enrolDevice,
// which Task 7 reshapes to take the device description the pairing code no longer carries. They are
// re-added there against the new signature; enrolDevice's body stays typecheck-red until then
// (it still reads the dropped binding columns from its DELETE … RETURNING — RULING 1).

describe("generatePairingCode", () => {
  it("mints a bare bearer code and inserts only {tenant_id, location_id, code_sha256}", async () => {
    const cfg = await setupVenue();
    const { code } = await asApp(cfg, (tx) => generatePairingCode(tx, cfg));
    // A high-entropy 8-char Crockford-base32 string (≈40 bits), NOT a 6-digit PIN; the alphabet excludes
    // I/L/O/U so it is human-typeable off one screen onto another.
    expect(code).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
    // The row carries ONLY the tenant/venue scope and the code's digest — no kind/station/till/profile/
    // hardware (Task 4 dropped those columns; the device describes itself at enrol time, Task 7). The
    // stored digest is the sha256 of the NORMALIZED code — the exact key enrolDevice looks it up under.
    const codeSha256 = createHash("sha256").update(normalizePairingCode(code)).digest("hex");
    const { rows } = await db.execute<{
      tenant_id: string;
      location_id: string;
      code_sha256: string;
    }>(
      sql`select tenant_id, location_id, code_sha256 from device_pairing_codes
          where tenant_id = ${cfg.tenantId}`,
    );
    expect(rows).toEqual([
      { tenant_id: cfg.tenantId, location_id: cfg.locationId, code_sha256: codeSha256 },
    ]);
  });

  it("no longer validates or stores device bindings (station/till/binding paths are gone)", async () => {
    // The mint-time station_required / till_required / binding_invalid gates moved to enrolDevice
    // (Task 7): generatePairingCode takes no kind/station/till at all, so a bare call — which under the
    // old shape would have thrown device.station_required for a kds_station with no station — now simply
    // mints a code.
    const cfg = await setupVenue();
    await expect(asApp(cfg, (tx) => generatePairingCode(tx, cfg))).resolves.toMatchObject({
      code: expect.stringMatching(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/),
    });
  });

  it("translates a digest collision (23505) to device.pairing_code_unavailable", async () => {
    // Force the ~2^-40 collision deterministically via the injectable codeSource (the ONLY knob): two
    // mints of the SAME code collide on the (tenant_id, code_sha256) unique index → a clean, retryable
    // domain code the manager re-mints on, never an opaque server.internal 500.
    const cfg = await setupVenue();
    const fixedCode = (): string => "ABCDEFGH";
    await asApp(cfg, (tx) => generatePairingCode(tx, cfg, fixedCode));
    await expect(asApp(cfg, (tx) => generatePairingCode(tx, cfg, fixedCode))).rejects.toMatchObject(
      {
        code: "device.pairing_code_unavailable",
      },
    );
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

describe("bindingFkField", () => {
  // The 23503 → field accessor, exercised with CRAFTED errors (no DB) so every branch is covered: the
  // `tables.ts` `isZoneFkViolation` / `uniqueViolationConstraint` idiom. The end-to-end 23503 translation
  // is proven against real Postgres in device.pg.test.ts; here we pin the constraint-name mapping and
  // the deliberate NON-matches (a different constraint, a different SQLSTATE, no constraint name).
  const fk = (constraint: string): Error =>
    Object.assign(new Error("fk"), { code: "23503", constraint });

  it("maps the device binding composite FKs' constraint names to their input fields", () => {
    // The device-binding composite FKs on the `devices` table: `devices_device_profile_fk` (a reassign
    // to a profile that names no row of this tenant → `deviceProfileId`, the assign-device-profile route)
    // and `devices_receipt_printer_fk` (a hardware PATCH naming a printer of no such tenant row →
    // `receiptPrinterId`). Since Task 6 the pairing code carries no bindings, so these are the only two.
    expect(bindingFkField(fk("devices_device_profile_fk"))).toBe("deviceProfileId");
    expect(bindingFkField(fk("devices_receipt_printer_fk"))).toBe("receiptPrinterId");
  });

  it("returns undefined for the dropped pairing-code composite FKs (bindings gone, Tasks 4/6)", () => {
    // The pairing code's former mint-time FKs (till / receipt printer / device profile) went with the
    // columns, so a 23503 naming one no longer maps to a field — it would rethrow raw.
    expect(bindingFkField(fk("device_pairing_codes_till_fk"))).toBeUndefined();
    expect(bindingFkField(fk("device_pairing_codes_receipt_printer_fk"))).toBeUndefined();
    expect(bindingFkField(fk("device_pairing_codes_device_profile_fk"))).toBeUndefined();
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
      cause: new Error("mid", { cause: fk("devices_device_profile_fk") }),
    });
    expect(bindingFkField(wrapped)).toBe("deviceProfileId");
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
