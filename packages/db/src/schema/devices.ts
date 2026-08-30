import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { locations, tenants } from "./tenants.js";

/**
 * The KIND of device a `devices` row represents (device-identity-1, §2a). `kds_station` — an
 * always-on kitchen screen — binds to one kitchen station; `handheld` — a roving waiter phone that
 * takes tableside orders (handheld-tableside-ordering spec §2, §8a) — is location-wide and binds to
 * NO station. It is a pgEnum, not a text check, so trusting the till device itself, or a
 * customer-facing display, is an ADDITIVE enum value later rather than a destructive migration
 * (spec §0, §9). Both `devices` and `device_pairing_codes` carry a column of this type, so
 * drizzle-kit emits `CREATE TYPE device_kind` once. The per-kind station rule (kds_station ⇒ a
 * station, handheld ⇒ none) is a hand-written CHECK on both tables (drizzle-kit models no raw
 * CHECKs); a future kind must add its own clause there.
 */
export const deviceKind = pgEnum("device_kind", ["kds_station", "handheld"]);

/**
 * An always-on trusted DEVICE (device-identity-1) — a physical screen that enrols ONCE via a pairing
 * code and authenticates itself thereafter with an httpOnly cookie, with NO per-person login. Only
 * the `kds_station` kind is wired now: it binds to a single `kitchen_stations` row and may read and
 * bump only that station's queue (spec §1, §3d). Tenant + location scoped (spec §2a) — separate
 * `tenant_id` and `location_id` FKs, both `onDelete restrict`, the `shifts` shape; the station binding
 * narrows it further to one kitchen display within that venue.
 *
 * `token_hash` is the scrypt hash of the device token (`hashSecret`, packages/identity secret-hash.ts,
 * §2c): the plaintext lives ONLY in the cookie, never at rest. Revoke by flipping `active = false`
 * (instant — `requireDevice` rejects it), NEVER a hard DELETE, because a device is a durable identity
 * and later tables may reference it — so `app_user` holds SELECT/INSERT/UPDATE and no DELETE, exactly
 * the `kitchen_stations` shape, granted in the paired --custom migration.
 *
 * `station_id` is a BARE uuid: the tenant-consistent (tenant_id, station_id) → kitchen_stations
 * (tenant_id, id) composite FK is hand-written in the --custom migration (the KDS-1 idiom — a
 * `kitchen_stations` table, so its FK cannot be a one-arg `.references()`), exactly as
 * `ticket_items.station_id` is. NULLABLE so a future non-station kind carries no station; MATCH
 * SIMPLE (the FK default) skips the check on a NULL station_id.
 *
 * `.enableRLS()` emits only ENABLE ROW LEVEL SECURITY. The FORCE ROW LEVEL SECURITY, the
 * `devices_tenant_isolation` policy and the grant are hand-written in the paired --custom migration,
 * exactly as 0055 does for `kitchen_stations`. The `inmutabilidad` guard in packages/fiscal-verifactu
 * scans every tenant_id-bearing table for both RLS flags, so a missing FORCE here fails that suite.
 */
export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      // Two-arg `.references()` so v8 tracks this thunk as its own never-invoked function (drizzle-kit
      // resolves it in a separate CLI process), the reason kitchen-stations.ts / ticket-items.ts use this form.
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    // The venue the device lives in — a required scope, like tenant_id. A DIRECT location_id →
    // locations.id FK with onDelete restrict, mirroring `shifts` (shifts_location_fk), the precedent
    // the spec cites (§2a "the shifts shape") — NOT the composite (tenant_id, location_id) FK
    // kitchen_stations uses. The station binding narrows it further to one display.
    locationId: uuid("location_id")
      .notNull()
      /* v8 ignore next */
      .references(() => locations.id, { onDelete: "restrict" }),
    deviceKind: deviceKind("device_kind").notNull(),
    // The kds_station binding. Bare column: the tenant-consistent (tenant_id, station_id) →
    // kitchen_stations(tenant_id, id) FK is hand-written in the --custom migration. NULLABLE — a
    // future non-station kind carries no station (MATCH SIMPLE skips the FK check on a NULL).
    stationId: uuid("station_id"),
    // The human label ("Pantalla Cocina"), shown in device management.
    label: text("label").notNull(),
    // scrypt hash of the device token (hashSecret, secret-hash.ts). Never the plaintext token.
    tokenHash: text("token_hash").notNull(),
    // Revoke = active := false, checked in requireDevice for instant revocation. No hard delete.
    active: boolean("active").notNull().default(true),
    // Touched by requireDevice on each authenticated request. NULL until the device is first seen.
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite (tenant_id, id) UNIQUE — the target a later table's tenant-consistent
    // (tenant_id, device_id) FK would use, the same role kitchen_stations_tenant_id_key plays.
    unique("devices_tenant_id_key").on(t.tenantId, t.id),
  ],
).enableRLS();

/**
 * A short-lived, single-use PAIRING CODE (device-identity-1, §2b). An admin mints one bound to a
 * station (the `device.manage` generate verb); the kitchen screen redeems it and becomes a `devices`
 * row. Modelled on the WebAuthn challenge (packages/identity passkey.ts): the TTL is computed in code
 * from `created_at` (there is deliberately no `expires_at` column), and redemption is a locking
 * `DELETE … RETURNING` that serialises concurrent redeems and consumes the code.
 *
 * That DELETE is why `app_user` holds DELETE here — NOVEL for this repo's tenant tables (the DELETE
 * precedent is 0039/0042) — and no UPDATE: a code is consumed, never edited. The grant
 * (SELECT/INSERT/DELETE) is hand-written in the paired --custom migration.
 *
 * `code_sha256` is the SHA-256 of a high-entropy pairing code (§2c), the deterministic lookup key
 * the redeeming device selects on (it sends only the code, no selector, so a per-row scrypt salt
 * cannot be used for lookup). The `(tenant_id, code_sha256)` index is that redemption path.
 * `station_id` is a BARE uuid whose composite FK is hand-written like `devices.station_id`.
 *
 * `.enableRLS()` emits only ENABLE; FORCE + the `device_pairing_codes_tenant_isolation` policy + the
 * grant are hand-written in the --custom migration (inmutabilidad requires FORCE on every
 * tenant_id-bearing table).
 */
export const devicePairingCodes = pgTable(
  "device_pairing_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    // The venue the code (and the device it enrols) belongs to — required scope. Direct location_id →
    // locations.id FK, onDelete restrict, the `shifts` shape (spec §2b), as on `devices`.
    locationId: uuid("location_id")
      .notNull()
      /* v8 ignore next */
      .references(() => locations.id, { onDelete: "restrict" }),
    // SHA-256 of a high-entropy pairing code (§2c) — the indexed lookup key. Not a per-row-salted
    // scrypt hash: the redeeming device sends only the code, so lookup must be by a deterministic
    // digest. High entropy + single-use + a short TTL is what keeps that lookup safe.
    codeSha256: text("code_sha256").notNull(),
    deviceKind: deviceKind("device_kind").notNull(),
    // The station binding to stamp on the enrolled device. Bare column: composite FK hand-written.
    stationId: uuid("station_id"),
    // The label to give the enrolled device.
    label: text("label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite (tenant_id, id) UNIQUE — the composite-FK target, as for the other tenant tables.
    unique("device_pairing_codes_tenant_id_key").on(t.tenantId, t.id),
    // The redemption lookup path: DELETE … WHERE tenant_id = $t AND code_sha256 = $h RETURNING.
    // UNIQUE, not a plain index: `enrolDevice`'s DELETE … RETURNING reads only the FIRST row, so two
    // rows sharing a (tenant, digest) would let one escape consumption — breaking the single-use
    // invariant. The unique index makes that unrepresentable and serves the lookup identically; the
    // generator's ~1-in-2^40 duplicate now fails the INSERT (the manager retries) rather than silently
    // minting a consumable duplicate. tenant_id leads the key, so uniqueness is per-tenant.
    uniqueIndex("device_pairing_codes_lookup_idx").on(t.tenantId, t.codeSha256),
  ],
).enableRLS();
