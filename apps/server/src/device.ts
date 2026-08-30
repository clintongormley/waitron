// Side-effect only: keeps this host's `device.*`/`station.*` codes (errors.ts) reachable from the file
// that throws them — the reachability convention kitchen.ts/till-sale.ts follow. See errors.ts.
import "./errors.js";
import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { deviceKind, devicePairingCodes, devices, isUniqueViolation } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { hashSecret } from "@waitron/identity";
import type { TillConfig } from "./till-config.js";
import { requireLiveStation } from "./kitchen.js";

// device-identity-1 §3a/§3b — the CRYPTO CORE of station enrolment. Two pure verbs on the caller's
// transaction (the route layer, Task 5, wraps each in withTenant/asAppUser and owns the HTTP status
// mapping): an admin MINTS a single-use pairing code bound to a station, and a screen REDEEMS it to
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

/** The kind of device an enrolment produces. Derived from the `device_kind` pgEnum so it stays in
 * lockstep with the schema. Two kinds are wired end-to-end (mint, enrol, session, firewall): a
 * `kds_station` (an always-on kitchen screen, station-bound) and a `handheld` (a roving, station-less
 * waiter phone — the order-only tableside device). */
export type DeviceKind = (typeof deviceKind.enumValues)[number];

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

/** Whether a device kind binds a kitchen station. A `kds_station` is an always-on screen tied to one
 * station; a `handheld` is a roving, location-wide waiter device (spec §D2) and carries none. This is
 * the code-side twin of the Task-1 DB CHECK (`0076`, `kds_station ⇒ station_id NOT NULL`,
 * `handheld ⇒ station_id NULL`): a kind added here that requires a station must gain that CHECK too. */
export function kindRequiresStation(kind: DeviceKind): boolean {
  return kind === "kds_station";
}

/**
 * Mint a single-use pairing code (device-identity-1 §3a), station-optional per kind. For a
 * station-binding kind ({@link kindRequiresStation}) the station must be a LIVE station of THIS venue —
 * `requireLiveStation` (kitchen.ts, `station.not_found` otherwise) is REUSED verbatim so a code can
 * never be minted against a retired, foreign-venue or non-existent station, and a null one is rejected
 * up front as `device.station_required` (a validation failure, no uuid to echo — distinct from the
 * `station.not_found` a SUPPLIED-but-invalid station raises); that check runs BEFORE any write. A non-binding kind (a handheld) stores
 * `station_id = NULL` and never calls `requireLiveStation`. Stores only the code's SHA-256 (never the
 * plaintext) plus the kind/station/label to stamp on the enrolled device, and returns the plaintext
 * code ONCE for the operator to read into the pairing screen.
 */
export async function generatePairingCode(
  tx: Transaction,
  cfg: TillConfig,
  input: { kind: DeviceKind; stationId: string | null; label: string },
  // Injectable code source, defaulting to the real high-entropy generator — the ONLY knob, mirroring the
  // enrol rate-limiter's injectable `now` (enrol-rate-limit.ts). It exists so a test can FORCE a digest
  // collision deterministically (the ~2^-40 duplicate is unreachable by chance); production always uses
  // the default.
  codeSource: () => string = () => encodePairingCode(randomBytes(PAIRING_CODE_BYTES)),
): Promise<{ code: string }> {
  // A station-binding kind must NAME a station and it must be LIVE. A null station is a VALIDATION
  // failure — `device.station_required` (nothing was looked up, so there is no uuid to echo) — distinct
  // from `station.not_found`, which `requireLiveStation` raises for an unknown/foreign/retired station
  // that WAS supplied (echoing that uuid). Both run before any write. A non-binding kind (handheld)
  // carries no station and skips the check, so `stationId` is forced NULL for the insert — the Task-1
  // CHECK (`handheld ⇒ station_id IS NULL`) would reject a non-null one anyway.
  const requiresStation = kindRequiresStation(input.kind);
  let stationId: string | null = null;
  if (requiresStation) {
    if (input.stationId === null) throw new AppError("device.station_required", {});
    await requireLiveStation(tx, cfg, input.stationId);
    stationId = input.stationId;
  }
  const code = codeSource();
  try {
    await tx.insert(devicePairingCodes).values({
      tenantId: cfg.tenantId,
      // The venue requireLiveStation just confirmed the station belongs to (or the venue the handheld
      // roves) — the scope stamped onto the enrolled device, so it is fixed here rather than re-derived
      // at redemption.
      locationId: cfg.locationId,
      codeSha256: createHash("sha256").update(code).digest("hex"),
      deviceKind: input.kind,
      stationId,
      label: input.label,
    });
  } catch (error) {
    // A 23505 here is a digest collision on `device_pairing_codes_lookup_idx` — the UNIQUE index on
    // (tenant_id, code_sha256) added for single-use safety (385b6248), so the redeeming DELETE …
    // RETURNING can never consume a duplicate. The code is ~40-bit, so this needs the SHA-256 of a fresh
    // random code to collide with an outstanding code's digest: astronomically rare (~2^-40 per mint ×
    // outstanding codes) but real, and the raw constraint error would otherwise surface as an opaque
    // `server.internal` 500. Map it to a clean, retryable domain code (the manager re-mints). The
    // table's other two uniques — the `id` PK and `device_pairing_codes_tenant_id_key` (tenant_id, id) —
    // both key on a fresh `defaultRandom()` uuid, a 2^-122 collision that is not realistically reachable,
    // so a 23505 on THIS insert is the digest one; `isUniqueViolation` alone identifies it without a
    // constraint-name check, exactly as passkey.ts's register insert reasons about its own fresh-uuid PK.
    // The tx is aborted after the 23505, so the catch does NO further DB work — it just throws, and the
    // caller's withTenant rolls back (nothing was written). Anything that is NOT a unique violation is a
    // genuine failure and is rethrown unchanged.
    if (isUniqueViolation(error)) {
      throw new AppError("device.pairing_code_unavailable", {});
    }
    throw error;
  }
  return { code };
}

/**
 * Redeem a pairing code and enrol the device (device-identity-1 §3b). Mirrors the WebAuthn
 * `consumeChallenge` semantic (passkey.ts:108-121) EXACTLY:
 *
 *  1. A locking `DELETE FROM device_pairing_codes WHERE tenant_id AND code_sha256 = sha256(code)
 *     RETURNING` — Drizzle-parameterised, never string-concatenated. The DELETE row-locks the code, so
 *     two devices racing on the SAME code serialise: the second blocks, then — once the first commits —
 *     matches ZERO rows. No row (unknown, mistyped, or already-consumed, all folded) → `device.pairing_invalid`.
 *  2. `now - created_at > PAIRING_TTL_MS` → `device.pairing_expired`. The throw rolls the caller's
 *     transaction back, UNDOING the consume-DELETE, so an expired code lapses by its TTL rather than
 *     being burned by the too-late attempt (the WebAuthn semantic). No catch/commit around this — the
 *     route's withTenant transaction rolls it back.
 *  3. Mint a long-lived token (`randomBytes(32).toString("base64url")`) and INSERT the `devices` row with
 *     its scrypt hash (`hashSecret`, @waitron/identity) — the plaintext lives ONLY in the returned value
 *     the route puts in the cookie, never at rest.
 *
 * Returns the enrolled device's id + the kind/station/label it was minted with + the raw token.
 */
export async function enrolDevice(
  tx: Transaction,
  cfg: TillConfig,
  input: { code: string },
): Promise<{
  deviceId: string;
  kind: DeviceKind;
  stationId: string | null;
  label: string;
  token: string;
}> {
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
      kind: devicePairingCodes.deviceKind,
      stationId: devicePairingCodes.stationId,
      label: devicePairingCodes.label,
      locationId: devicePairingCodes.locationId,
    });
  if (row === undefined) throw new AppError("device.pairing_invalid", {});
  if (Date.now() - Date.parse(row.createdAt) > PAIRING_TTL_MS) {
    throw new AppError("device.pairing_expired", {});
  }

  const token = randomBytes(32).toString("base64url");
  const [device] = await tx
    .insert(devices)
    .values({
      tenantId: cfg.tenantId,
      locationId: row.locationId,
      deviceKind: row.kind,
      stationId: row.stationId,
      label: row.label,
      tokenHash: hashSecret(token),
      active: true,
    })
    .returning({ id: devices.id });
  return {
    deviceId: device!.id,
    kind: row.kind,
    stationId: row.stationId,
    label: row.label,
    token,
  };
}
