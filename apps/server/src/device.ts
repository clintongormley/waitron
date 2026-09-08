// Side-effect only: keeps this host's `device.*`/`station.*` codes (errors.ts) reachable from the file
// that throws them — the reachability convention kitchen.ts/till-sale.ts follow. See errors.ts.
import "./errors.js";
import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import {
  devicePairingCodes,
  devices,
  isUniqueViolation,
  pgErrorConstraint,
  tills,
  uniqueViolationConstraint,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { getDeviceProfile, kindOfFormFactor, listDeviceProfiles } from "@waitron/layouts";
import type { DeviceKind, FormFactor } from "@waitron/layouts";
import { hashSecret } from "@waitron/identity";
import { listStations, requireLiveStation } from "./kitchen.js";
import type { TillConfig } from "./till-config.js";

// device-identity-1 §3a/§3b — the CRYPTO CORE of device enrolment. Two pure verbs on the caller's
// transaction (the route layer wraps each in withTenant/asAppUser and owns the HTTP status mapping):
// an admin MINTS a single-use, BARE bearer pairing code — it carries no device description — and a
// screen REDEEMS it, describing ITSELF at enrol time (its profile, and its station or register), to
// become a trusted `devices` row that authenticates thereafter with a scrypt-hashed token cookie.
//
// Two-tier secret handling (§2c), and every hash/compare is REUSED, never home-rolled:
//  - the pairing code is EPHEMERAL (single-use, 15-min TTL) and must be looked up by the redeeming
//    device from the code alone, so its at-rest form is a deterministic SHA-256 (createHash, node:crypto)
//    — the indexed lookup key; high entropy + single-use + short TTL is what keeps that digest safe;
//  - the device token is LONG-LIVED and salted per row, so it is scrypt (hashSecret, @waitron/identity)
//    — the same KDF PINs and passwords use — and never stored plaintext.
// The plaintext code and token each leave this module EXACTLY ONCE (the return values, for the operator
// to read / the route to set the cookie); neither is ever logged or persisted in the clear.

/** The kind of device an enrolment produces — re-exported from `@waitron/layouts`, which owns the
 * type now that the `device_kind` pgEnum is gone (a device's kind is DERIVED from its profile's form
 * factor via {@link kindOfFormFactor}). Three kinds are wired end-to-end (mint, enrol, session,
 * firewall): a `kds_station` (an always-on kitchen screen, station-bound), a `handheld` (a roving,
 * station-less waiter phone that takes/fires tableside orders and settles sales at the table for cash
 * or a MANUAL card tender — the datáfono leg, no integrated reader — fenced from the INTEGRATED card
 * reader (`/api/pay`) and the other fiscal/cash routes: reprint, drawer-open, place, collect, cancel),
 * and a `till`. The authoritative fenced/allowed surface is the till-api firewall, `assertNotHandheld`
 * in device-session.ts and the FENCED/ALLOWED table atop till-api.ts. */
export type { DeviceKind };

/**
 * How long a minted pairing code stays redeemable — spec §2c, the WebAuthn `CHALLENGE_TTL_MS` analogue
 * (passkey.ts:53), just longer because an operator carries the code between two screens by hand. The TTL
 * is computed in code from `created_at` (there is deliberately no `expires_at` column, §2b); a code
 * older than this redeems `device.pairing_expired`, and — because the redeeming DELETE is rolled back
 * with the enclosing transaction on that throw — the row survives to lapse by its TTL rather than being
 * burned by the too-late attempt.
 */
export const PAIRING_TTL_MS = 15 * 60 * 1000; // 15 minutes

/** Bytes of entropy per pairing code: 5 bytes = 40 bits = exactly 8 Crockford-base32 chars (40 is a
 * multiple of 5, so there is no remainder and no padding). ≈40 bits, single-use, 15-min TTL — a
 * high-entropy secret, NOT a 6-digit PIN, which a brute-force could walk (§2c). */
const PAIRING_CODE_BYTES = 5;

/**
 * The Crockford base32 alphabet — the RFC-4648 set minus I, L, O and U, so an operator reading a code
 * off one screen and typing it into another cannot confuse it with 1/1, 0/O or U/V. This is an
 * ENCODING (regroup the random bits, index the alphabet), NOT a hash or a comparison: the
 * "reuse crypto, write none" rule (CLAUDE.md §3) governs hashing and constant-time compare, which stay
 * in node:crypto and @waitron/identity — the entropy here comes from `randomBytes`, and there is no
 * secret-dependent branch to leak. No reusable base32 encoder exists in the tree to borrow (the only
 * base32 in the repo is otplib's internal RFC-4648 decoder, reached through `totp.ts`, which uses a
 * different alphabet and is not exported), so this small pure encoder is written here.
 */
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Encode `bytes` as a Crockford-base32 string, 5 bits per character. The 40 random bits are accumulated
 * big-endian into a BigInt — a plain `number` overflows the 32-bit bitwise operators past the fourth
 * byte — then read 5 bits at a time from the top. `bytes.length * 8` is a multiple of 5 for the 5-byte
 * pairing code, so the loop emits whole characters with nothing left over (no padding case to handle).
 */
export function encodePairingCode(bytes: Buffer): string {
  let acc = 0n;
  for (const byte of bytes) acc = (acc << 8n) | BigInt(byte);
  let code = "";
  for (let shift = bytes.length * 8 - 5; shift >= 0; shift -= 5) {
    code += CROCKFORD_ALPHABET[Number((acc >> BigInt(shift)) & 0x1fn)];
  }
  return code;
}

/**
 * Fold an operator-typed pairing code back to the canonical form the encoder emits, so redemption is
 * lenient regardless of how the code was transcribed off one screen onto another (§2c). Applied as the
 * FIRST thing {@link enrolDevice} does, so the leniency holds for every caller (the route, a test, a
 * future CLI) and is not the HTTP layer's job.
 *
 * Four normalizations, matching standard Crockford DECODE leniency: uppercase; strip the spaces and
 * hyphens a human may group the code with; and map the visually-ambiguous letters `I`/`L` → `1` and
 * `O` → `0`. This is safe by construction and NOT a hash or a comparison (the "reuse crypto, write none"
 * rule, CLAUDE.md §3, governs hashing/constant-time compare, which stay in node:crypto/@waitron/identity):
 * the encoder's alphabet is the RFC-4648 set MINUS I, L, O and U, so I/L/O are characters it can never
 * emit. Rewriting a never-emitted character onto a canonical one is therefore INJECTIVE over real codes —
 * it can never collapse two distinct minted codes into one, so there is no security regression, and on a
 * canonical code (all four rules are no-ops) it is the identity.
 */
export function normalizePairingCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
}

/** The pg SQLSTATE for a foreign-key violation, as `@waitron/printing`'s `printers.ts` and
 * `tables.ts`'s `isZoneFkViolation` name it. */
const FOREIGN_KEY_VIOLATION = "23503";

/**
 * A device composite binding FK and the input FIELD it guards. A 23503 on one of these means a device
 * write (enrol, `assign-device-profile`, or the hardware PATCH) named a binding that no row of this
 * tenant matches — the composite makes each check tenant-isolated and atomic with the write (no
 * read-then-write race), so the routes translate it here rather than pre-checking:
 *  - `devices_device_profile_fk (tenant_id, device_profile_id)` — a reassign to an unknown/foreign
 *    profile (`deviceProfileId`);
 *  - `devices_receipt_printer_fk (tenant_id, receipt_printer_id)` — a hardware PATCH naming an
 *    unknown/foreign printer (`receiptPrinterId`).
 * The pairing code carries no bindings, so its former mint-time composite FKs are gone with the
 * columns (Task 4).
 */
const BINDING_FK_FIELD: Record<string, "deviceProfileId" | "receiptPrinterId"> = {
  devices_device_profile_fk: "deviceProfileId",
  devices_receipt_printer_fk: "receiptPrinterId",
};

/**
 * If `error` (or anything it wraps) is a 23503 on one of the device binding composite FKs, the input
 * FIELD it guards (`deviceProfileId`/`receiptPrinterId`); otherwise `undefined`. Reuses `@waitron/db`'s
 * `pgErrorConstraint` to walk the cause chain and read the offending constraint name — Drizzle wraps
 * every failed query in a `DrizzleQueryError` whose own `.code` is undefined, so the real SQLSTATE and
 * `.constraint` name live on `.cause` (node-postgres), one level deeper still under PGlite — then maps
 * that name through {@link BINDING_FK_FIELD}. It keys on the CONSTRAINT NAME, not merely the 23503
 * code, so a 23503 on a DIFFERENT constraint (the tenant/location direct FKs) — or one whose driver
 * reported no constraint name — returns `undefined` and is rethrown raw rather than mislabelled
 * `device.binding_invalid`. The `isZoneFkViolation` idiom (`tables.ts`). Exported for the crafted-error
 * unit tests, NOT from a package barrel (this is an application, not a library).
 */
export function bindingFkField(error: unknown): "deviceProfileId" | "receiptPrinterId" | undefined {
  const constraint = pgErrorConstraint(error, FOREIGN_KEY_VIOLATION);
  return constraint === undefined ? undefined : BINDING_FK_FIELD[constraint];
}

/**
 * Mint a single-use pairing code (device-identity-1 §3a). The code is a BARE bearer token: it carries
 * no device description (kind, station, till, profile, hardware) — the device describes itself when it
 * redeems the code and enrols (Task 7; the mint-time binding columns were dropped in Task 4). Stores
 * only the code's SHA-256 (never the plaintext), scoped to this tenant + venue, and returns the
 * plaintext code ONCE for the operator to read into the pairing screen.
 *
 * `codeSource` is an injectable code generator defaulting to the real high-entropy one — the ONLY knob,
 * mirroring the enrol rate-limiter's injectable `now` (enrol-rate-limit.ts). It exists so a test can
 * FORCE a digest collision deterministically (the ~2^-40 duplicate is unreachable by chance); production
 * always uses the default.
 */
export async function generatePairingCode(
  tx: Transaction,
  cfg: TillConfig,
  codeSource: () => string = () => encodePairingCode(randomBytes(PAIRING_CODE_BYTES)),
): Promise<{ code: string }> {
  const code = codeSource();
  try {
    await tx.insert(devicePairingCodes).values({
      tenantId: cfg.tenantId,
      // The venue the enrolling device belongs to — the scope stamped on the code, fixed here rather
      // than re-derived at redemption.
      locationId: cfg.locationId,
      codeSha256: createHash("sha256").update(code).digest("hex"),
    });
  } catch (error) {
    // A 23505 here is a digest collision on `device_pairing_codes_lookup_idx` — the UNIQUE index on
    // (tenant_id, code_sha256) that keeps the redeeming DELETE … RETURNING single-use. The code is
    // ~40-bit, so this needs the SHA-256 of a fresh random code to collide with an outstanding code's
    // digest: astronomically rare (~2^-40 per mint × outstanding codes) but real, and the raw constraint
    // error would otherwise surface as an opaque `server.internal` 500. Map it to a clean, retryable
    // domain code (the manager re-mints). The table's other two uniques — the `id` PK and
    // `device_pairing_codes_tenant_id_key` (tenant_id, id) — both key on a fresh `defaultRandom()` uuid,
    // a 2^-122 collision that is not realistically reachable, so a 23505 on THIS insert is the digest
    // one; `isUniqueViolation` alone identifies it without a constraint-name check, exactly as
    // passkey.ts's register insert reasons about its own fresh-uuid PK. The tx is aborted after the
    // violation, so the catch does NO further DB work — it throws, and the caller's withTenant rolls back
    // (nothing was written).
    if (isUniqueViolation(error)) {
      throw new AppError("device.pairing_code_unavailable", {});
    }
    throw error;
  }
  return { code };
}

/** The UNIQUE index that makes a duplicate register name at one venue unrepresentable
 * (`tills_tenant_location_name_key`, migration 0006). {@link createRegister} keys its 23505
 * translation on this name so an unrelated unique violation is rethrown raw, not mislabelled. */
const TILL_NAME_UNIQUE = "tills_tenant_location_name_key";

/**
 * Auto-create the cash register a `till`-form-factor device rings against, named after the device, and
 * return its id. Runs on the caller's transaction (never its own), so the enclosing enrolment's throw —
 * including this function's own — discards the register with the device (no orphan till, CLAUDE.md §3).
 * A name already used at this venue trips {@link TILL_NAME_UNIQUE} (23505) → `device.register_name_taken`
 * (the operator renames the device rather than ending up with two indistinguishable registers); the
 * unique index is the whole guard (`tills` is a `state` table), keyed by CONSTRAINT NAME so an unrelated
 * unique violation is rethrown raw — the `translateWriteError` idiom (device-profile-store.ts).
 */
async function createRegister(
  tx: Transaction,
  cfg: TillConfig,
  locationId: string,
  name: string,
): Promise<string> {
  try {
    const [till] = await tx
      .insert(tills)
      .values({ tenantId: cfg.tenantId, locationId, name })
      .returning({ id: tills.id });
    return till!.id;
  } catch (error) {
    if (isUniqueViolation(error)) {
      const constraint = uniqueViolationConstraint(error);
      // PGlite may report no constraint name; the only unique this narrow insert can trip is the
      // venue-scoped name index, so a nameless 23505 here is that one (the `translateWriteError` fallback).
      if (constraint === undefined || constraint === TILL_NAME_UNIQUE) {
        throw new AppError("device.register_name_taken", {});
      }
    }
    throw error;
  }
}

/**
 * Assert `registerId` names a `tills` row of THIS tenant at THIS venue and return it. A by-id read that
 * carries its OWN `tenant_id` predicate — one-tenant-per-db is NOT the query's isolation boundary
 * (CLAUDE.md §3) — plus the `location_id` scope, so a register that is absent, another tenant's, or
 * another venue's is rejected here rather than trusted or left to the `devices` composite FK (which
 * sees neither location). No such row → `device.binding_invalid` naming the `tillId` FIELD (never the
 * id), the code the domain already uses for "named a binding id that matches no row of this tenant".
 */
async function requireLiveRegister(
  tx: Transaction,
  cfg: TillConfig,
  locationId: string,
  registerId: string,
): Promise<string> {
  const [till] = await tx
    .select({ id: tills.id })
    .from(tills)
    .where(
      and(
        eq(tills.tenantId, cfg.tenantId),
        eq(tills.locationId, locationId),
        eq(tills.id, registerId),
      ),
    );
  if (till === undefined) throw new AppError("device.binding_invalid", { field: "tillId" });
  return till.id;
}

/**
 * The choices a device picks between when it enrols (device-identity-1 §3b) — what the pairing screen
 * shows after a code verifies. All scoped to the venue: the tenant's device PROFILES (the form factor
 * decides the rest of the flow), the venue's live kitchen STATIONS (a kds device binds one), and its
 * REGISTERS/tills (a handheld binds one). The `till` form factor mints its own register at enrol, so
 * the register list is for the handheld leg only.
 */
export interface EnrolCatalogue {
  profiles: { id: string; name: string; formFactor: FormFactor }[];
  stations: { id: string; name: string }[];
  registers: { id: string; name: string }[];
}

/**
 * Read the enrol catalogue for this venue — the profiles/stations/registers a verifying device chooses
 * from. Shared by {@link verifyPairingCode} (after a code verifies) and the enrol route's dev-code
 * branch (which returns the catalogue without a real code row). Every read is tenant-scoped; stations
 * and registers narrow to `cfg.locationId` (the venue), the same scope `enrolDevice` binds against.
 */
export async function readEnrolCatalogue(
  tx: Transaction,
  cfg: TillConfig,
): Promise<EnrolCatalogue> {
  const profiles = await listDeviceProfiles(tx, cfg.tenantId);
  const stations = await listStations(tx, cfg);
  const registers = await tx
    .select({ id: tills.id, name: tills.name })
    .from(tills)
    .where(and(eq(tills.tenantId, cfg.tenantId), eq(tills.locationId, cfg.locationId)))
    .orderBy(tills.name);
  return {
    profiles: profiles.map((p) => ({ id: p.id, name: p.name, formFactor: p.formFactor })),
    stations: stations.map((s) => ({ id: s.id, name: s.name })),
    registers,
  };
}

/**
 * Verify a pairing code WITHOUT consuming it (device-identity-1 §3b, the verify-then-enrol first step),
 * and return the venue's enrol catalogue. A plain SELECT on `(tenant_id, code_sha256)` — NOT the
 * consuming DELETE `enrolDevice` runs — so a device can read the catalogue, let the operator choose, and
 * then enrol with the SAME code (the second `enrolDevice` call is what burns it). No row (unknown /
 * mistyped / already-consumed) → `device.pairing_invalid`; `now - created_at > PAIRING_TTL_MS` →
 * `device.pairing_expired`, the SAME two faults `enrolDevice`'s DELETE raises. The rate-limit is the
 * ROUTE's job (before this runs), the enrol convention.
 */
export async function verifyPairingCode(
  tx: Transaction,
  cfg: TillConfig,
  code: string,
): Promise<EnrolCatalogue> {
  const codeSha256 = createHash("sha256").update(normalizePairingCode(code)).digest("hex");
  const [row] = await tx
    .select({ createdAt: devicePairingCodes.createdAt })
    .from(devicePairingCodes)
    .where(
      and(
        eq(devicePairingCodes.tenantId, cfg.tenantId),
        eq(devicePairingCodes.codeSha256, codeSha256),
      ),
    );
  if (row === undefined) throw new AppError("device.pairing_invalid", {});
  if (Date.now() - Date.parse(row.createdAt) > PAIRING_TTL_MS) {
    throw new AppError("device.pairing_expired", {});
  }
  return readEnrolCatalogue(tx, cfg);
}

/**
 * Redeem a pairing code and enrol the device (device-identity-1 §3b). The code is a BARE bearer token;
 * the DEVICE describes itself here — its profile, and its station (kds) or register (everything else) —
 * so this verb resolves the profile, derives the binding from the profile's form factor, and for a
 * `till` form factor AUTO-CREATES the register it rings against. Everything below runs in the caller's
 * ONE transaction (CLAUDE.md §3), so any throw rolls back the consume-DELETE, the register insert and
 * the device insert together.
 *
 *  1. A locking `DELETE FROM device_pairing_codes … RETURNING` (Drizzle-parameterised) consumes the
 *     code. It row-locks, so two devices racing the SAME code serialise: the second matches ZERO rows.
 *     No row (unknown / mistyped / already-consumed) → `device.pairing_invalid`; `now - created_at >
 *     PAIRING_TTL_MS` → `device.pairing_expired` (the throw rolls the DELETE back, so the code lapses by
 *     its TTL rather than being burned by the too-late attempt — the WebAuthn `consumeChallenge` semantic).
 *  2. Resolve the CLIENT-named device profile of THIS tenant ({@link getDeviceProfile}); absent (unknown
 *     or just-deleted) → `device_profile.not_found` (a 404 the operator recovers by re-picking).
 *  3. Bind per the profile's FORM FACTOR — the code-side twin of `device_binding_rule_insert / _update` (migration
 *     0004), the DB backstop: `kds` requires a live station ({@link requireLiveStation}:
 *     `device.station_required` if none supplied, `station.not_found` if unknown/foreign/retired) and no
 *     register; `till` mints its OWN register ({@link createRegister}, `device.register_name_taken` on a
 *     name already used at the venue); every other form factor requires a live register of this venue
 *     ({@link requireLiveRegister}: `device.register_required` if none supplied).
 *  4. Mint a long-lived token (`randomBytes(32)`) and INSERT the `devices` row with its scrypt hash
 *     (`hashSecret`) — the hardware columns left at their defaults (bound later via the dashboard). The
 *     plaintext token lives ONLY in the returned value the route puts in the cookie, never at rest.
 */
export async function enrolDevice(
  tx: Transaction,
  cfg: TillConfig,
  input: {
    code: string;
    name: string;
    profileId: string;
    stationId?: string | null;
    registerId?: string | null;
  },
): Promise<{ deviceId: string; name: string; formFactor: FormFactor; token: string }> {
  // Fold the typed code to its canonical form BEFORE hashing, so a lowercase / O-for-0 / I-for-1 /
  // space-or-hyphen-grouped transcription still redeems the row stored under the canonical SHA-256
  // (see {@link normalizePairingCode} for why this is injective and not a security regression).
  const code = normalizePairingCode(input.code);
  const codeSha256 = createHash("sha256").update(code).digest("hex");
  // Consume BEFORE anything else: the locking DELETE … RETURNING is the single-use guarantee under
  // concurrency (see the doc above). Parameterised by Drizzle — `code_sha256` binds as `$n`.
  const [row] = await tx
    .delete(devicePairingCodes)
    .where(
      and(
        eq(devicePairingCodes.tenantId, cfg.tenantId),
        eq(devicePairingCodes.codeSha256, codeSha256),
      ),
    )
    .returning({
      createdAt: devicePairingCodes.createdAt,
      // The venue the code was minted for — the device (and, for a `till`, its auto-created register)
      // lives here; the caller's cfg is trusted for the tenant, the consumed code for the venue.
      locationId: devicePairingCodes.locationId,
    });
  if (row === undefined) throw new AppError("device.pairing_invalid", {});
  if (Date.now() - Date.parse(row.createdAt) > PAIRING_TTL_MS) {
    throw new AppError("device.pairing_expired", {});
  }

  const binding = await resolveDeviceBinding(tx, cfg, row.locationId, {
    profileId: input.profileId,
    name: input.name,
    stationId: input.stationId,
    registerId: input.registerId,
  });

  const token = randomBytes(32).toString("base64url");
  const [device] = await tx
    .insert(devices)
    .values({
      tenantId: cfg.tenantId,
      locationId: row.locationId,
      stationId: binding.stationId,
      tillId: binding.tillId,
      deviceProfileId: input.profileId,
      label: input.name,
      tokenHash: hashSecret(token),
      active: true,
    })
    .returning({ id: devices.id });
  return { deviceId: device!.id, name: input.name, formFactor: binding.formFactor, token };
}

/**
 * Resolve which binding a device with this profile must carry, creating the register a counter till
 * owns. Lifted out of the old `enrolDevice` unchanged — the rules did not change, only who calls them:
 * accept now runs inside a `device.manage` management session rather than on an unauthenticated route,
 * which matters because this WRITES (a `till` form factor inserts a `tills` row).
 */
export async function resolveDeviceBinding(
  tx: Transaction,
  cfg: TillConfig,
  locationId: string,
  input: { profileId: string; name: string; stationId?: string | null; registerId?: string | null },
): Promise<{ stationId: string | null; tillId: string | null; formFactor: FormFactor }> {
  const profile = await getDeviceProfile(tx, cfg.tenantId, input.profileId);
  // `profileId` is a CLIENT choice (the operator picks it from the verify catalogue, or the admin
  // picks it in the accept dialog), so a well-formed id that names no profile of this tenant —
  // unknown, or one deleted meanwhile — is a CLIENT-recoverable 404, NOT a server fault: reuse
  // `device_profile.not_found` (the device-profile store's own "that profile isn't here" code, empty
  // params) rather than the opaque 500 a `device.profile_missing` would have paged as.
  if (profile === undefined) throw new AppError("device_profile.not_found", {});

  // The station/register binding this device carries, derived from its profile's form factor — the
  // one column NON-NULL for a kds device is `station_id`, for every other form factor `till_id`, and
  // `device_binding_rule_insert / _update` (migration 0004) is the DB backstop that refuses any other shape.
  let stationId: string | null = null;
  let tillId: string | null = null;
  switch (kindOfFormFactor(profile.formFactor)) {
    case "kds_station":
      if (input.stationId == null) throw new AppError("device.station_required", {});
      await requireLiveStation(tx, cfg, input.stationId);
      stationId = input.stationId;
      break;
    case "till":
      tillId = await createRegister(tx, cfg, locationId, input.name);
      break;
    case "handheld":
      if (input.registerId == null) throw new AppError("device.register_required", {});
      tillId = await requireLiveRegister(tx, cfg, locationId, input.registerId);
      break;
  }
  return { stationId, tillId, formFactor: profile.formFactor };
}
