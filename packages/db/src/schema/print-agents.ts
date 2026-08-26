import { boolean, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { locations, tenants } from "./tenants.js";

/**
 * A local PRINT AGENT (printing subsystem, §2a) — a process on a local box (the on-prem server, or a
 * separate box a USB printer is plugged into) that enrols ONCE via a pairing code and authenticates
 * itself thereafter with a scrypt-hashed bearer token. Modelled on the device-identity design
 * (`devices` — its own tables, its `hashSecret`/`verifySecret` scrypt token, its WebAuthn-challenge
 * single-use TTL pairing code), because a print agent is the same "enrol a trusted local box
 * centrally, revoke it centrally" problem — except it binds to PRINTERS (a `printers.agent_id`
 * composite FK points back at it), not to a station, so it carries no `station_id`/`device_kind`.
 *
 * Tenant + location scoped (spec §2a) — separate `tenant_id` and `location_id` FKs, both
 * `onDelete restrict`, the `shifts`/`devices` shape.
 *
 * `token_hash` is the scrypt hash of the agent token (`hashSecret`, packages/identity secret-hash.ts):
 * the plaintext lives ONLY in the agent's own store, never at rest here. Revoke by flipping
 * `active = false` (instant — `requireAgent` rejects it, a later task), NEVER a hard DELETE, because
 * a `print_jobs` history and `printers` bindings reference an agent — so `app_user` holds
 * SELECT/INSERT/UPDATE and no DELETE, exactly the `devices` shape, granted in the paired --custom
 * migration. `enrolled_at` is the creation stamp (there is no separate `created_at`, matching §2a).
 *
 * `.enableRLS()` emits only ENABLE ROW LEVEL SECURITY. The FORCE ROW LEVEL SECURITY, the
 * `print_agents_tenant_isolation` policy and the grant are hand-written in the paired --custom
 * migration, exactly as 0061 does for `devices`. The `inmutabilidad` guard in packages/fiscal-verifactu
 * scans every tenant_id-bearing table for both RLS flags, so a missing FORCE here fails that suite.
 */
export const printAgents = pgTable(
  "print_agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      // Two-arg `.references()` so v8 tracks this thunk as its own never-invoked function (drizzle-kit
      // resolves it in a separate CLI process), the reason devices.ts / kitchen-stations.ts use this form.
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    // The venue the agent lives in — a required scope, like tenant_id. A DIRECT location_id →
    // locations.id FK with onDelete restrict, the `shifts`/`devices` shape (§2a).
    locationId: uuid("location_id")
      .notNull()
      /* v8 ignore next */
      .references(() => locations.id, { onDelete: "restrict" }),
    // The human label ("Cocina USB"), shown in the Impresoras management surface.
    name: text("name").notNull(),
    // scrypt hash of the agent token (hashSecret, secret-hash.ts). Never the plaintext token.
    tokenHash: text("token_hash").notNull(),
    // Revoke = active := false, checked in requireAgent (a later task) for instant revocation. No hard delete.
    active: boolean("active").notNull().default(true),
    // Touched by requireAgent on each authenticated pull/report. NULL until the agent is first seen.
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite (tenant_id, id) UNIQUE — the target `printers.agent_id`'s tenant-consistent
    // (tenant_id, agent_id) FK points at (printers.ts), the same role devices_tenant_id_key plays.
    unique("print_agents_tenant_id_key").on(t.tenantId, t.id),
  ],
).enableRLS();

/**
 * A short-lived, single-use PAIRING CODE for print-agent enrolment (§2a). An admin mints one (the
 * `printer.manage` generate verb, a later task); the local agent redeems it and becomes a
 * `print_agents` row. Modelled on `device_pairing_codes` / the WebAuthn challenge: the TTL is
 * computed in code from `created_at` (there is deliberately no `expires_at` column), and redemption
 * is a locking `DELETE … RETURNING` that serialises concurrent redeems and consumes the code.
 *
 * That DELETE is why `app_user` holds DELETE here (the DELETE precedent is 0039/0042/0061) and no
 * UPDATE: a code is consumed, never edited. The grant (SELECT/INSERT/DELETE) is hand-written in the
 * paired --custom migration.
 *
 * `code_sha256` is the SHA-256 of a high-entropy pairing code (§2a), the deterministic lookup key the
 * redeeming agent selects on (it sends only the code, no selector, so a per-row scrypt salt cannot be
 * used for lookup). The `(tenant_id, code_sha256)` UNIQUE index is that redemption path — UNIQUE, not
 * plain, for the same single-use reason `device_pairing_codes_lookup_idx` gives. `label` is the name
 * to stamp on the enrolled agent.
 *
 * `.enableRLS()` emits only ENABLE; FORCE + the `print_agent_pairing_codes_tenant_isolation` policy +
 * the grant are hand-written in the --custom migration (inmutabilidad requires FORCE on every
 * tenant_id-bearing table).
 */
export const printAgentPairingCodes = pgTable(
  "print_agent_pairing_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    // The venue the code (and the agent it enrols) belongs to — required scope. Direct location_id →
    // locations.id FK, onDelete restrict, the `shifts`/`devices` shape (§2a).
    locationId: uuid("location_id")
      .notNull()
      /* v8 ignore next */
      .references(() => locations.id, { onDelete: "restrict" }),
    // SHA-256 of a high-entropy pairing code (§2a) — the indexed lookup key. Not a per-row-salted
    // scrypt hash: the redeeming agent sends only the code, so lookup must be by a deterministic
    // digest. High entropy + single-use + a short TTL is what keeps that lookup safe.
    codeSha256: text("code_sha256").notNull(),
    // The label to give the enrolled agent.
    label: text("label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite (tenant_id, id) UNIQUE — the composite-FK target, as for the other tenant tables
    // (device_pairing_codes_tenant_id_key plays the same role).
    unique("print_agent_pairing_codes_tenant_id_key").on(t.tenantId, t.id),
    // The redemption lookup path: DELETE … WHERE tenant_id = $t AND code_sha256 = $h RETURNING.
    // UNIQUE, not a plain index: the redeem reads only the FIRST row, so two rows sharing a
    // (tenant, digest) would let one escape consumption — breaking the single-use invariant. The
    // unique index makes that unrepresentable and serves the lookup identically; the generator's
    // ~1-in-2^40 duplicate now fails the INSERT (the manager retries) rather than silently minting a
    // consumable duplicate. tenant_id leads the key, so uniqueness is per-tenant.
    uniqueIndex("print_agent_pairing_codes_lookup_idx").on(t.tenantId, t.codeSha256),
  ],
).enableRLS();
