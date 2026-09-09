import { boolean, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { locations, tenants } from "./tenants.js";

/**
 * A local PRINT AGENT (printing subsystem, §2a) — a process on a local box (the on-prem server, or a
 * separate box a USB printer is plugged into) that enrols ONCE via join-and-accept (the box knocks
 * with a `join_requests` row an admin accepts) and authenticates itself thereafter with a
 * scrypt-hashed bearer token. Modelled on the device-identity design (`devices` — its own tables, its
 * `hashSecret`/`verifySecret` scrypt token), because a print agent is the same "enrol a trusted local
 * box centrally, revoke it centrally" problem — except it binds to PRINTERS (a `printers.agent_id`
 * composite FK points back at it), not to a station, so it carries no `station_id` (nor any
 * device-kind binding — a device's kind is derived from its profile's form factor, not a column).
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
);
