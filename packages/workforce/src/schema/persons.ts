import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "@waitron/db";

/**
 * A workforce role. A single `role` column on `persons` is the minimal identity floor: the only
 * workforce-internal role-gated action the legal floor needs is a supervisor-gated time correction
 * (Slice 3). Full RBAC, multi-role, and per-employment roles are the identity sub-project's (#5).
 *
 * A pgEnum rather than a text CHECK, matching working_order_status's precedent (packages/db
 * orders.ts): these four values are settled for the floor, and one declaration yields both the
 * TypeScript union and the database constraint.
 */
export const workforceRole = pgEnum("workforce_role", ["staff", "supervisor", "manager", "admin"]);

/** A person's account status. `suspended` keeps the row (and its immutable time history, Slice 2)
 * while refusing new clock-ins — the reason a status enum exists rather than a hard delete. */
export const personStatus = pgEnum("person_status", ["active", "suspended"]);

/**
 * A member of staff who can be attributed a clock event. Deliberately MUTABLE, unlike the fiscal
 * tables: a PIN is reset, a role changes, an account is suspended — so the app role holds
 * SELECT, INSERT, UPDATE here (drizzle/0001_workforce_rls.sql), never the append-only trigger the
 * time record itself will carry in Slice 2.
 *
 * This is the D0 identity stub. #5 later absorbs it and extends the same entity (invitations, full
 * RBAC); relocating it to a future packages/identity is a free rename pre-production, so building
 * it here costs nothing later.
 */
export const persons = pgTable(
  "persons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    displayName: text("display_name").notNull(),
    /** Hashed by ../verify-pin.ts (scrypt, salted) — never plaintext. The check below refuses an
     * empty value; the hash format itself is the caller's responsibility. */
    pinHash: text("pin_hash").notNull(),
    role: workforceRole("role").notNull().default("staff"),
    status: personStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The array `foreignKey({...})` form, not `.references(() => tenants.id)`: the thunk form makes
    // v8 count a never-invoked arrow as an uncovered function (drizzle-kit resolves it in a separate
    // CLI process, never during vitest run). restrict, not cascade: deleting a tenant must not
    // silently discard the people its time records attribute events to.
    foreignKey({
      columns: [t.tenantId],
      foreignColumns: [tenants.id],
      name: "persons_tenant_fk",
    }).onDelete("restrict"),
    index("persons_tenant_id_idx").on(t.tenantId),
    check("persons_display_name_ck", sql`length(${t.displayName}) > 0`),
    check("persons_pin_hash_ck", sql`length(${t.pinHash}) > 0`),
  ],
).enableRLS();
