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
 * A person's role. A single `role` column is this slice's permission-assignment mechanism (design
 * decision 3): call sites gate on a permission, and packages/identity/src/permissions.ts maps each
 * role to its permission set. A pgEnum, not a text CHECK: the four values are settled, and one
 * declaration yields both the TypeScript union and the database constraint.
 */
export const personRole = pgEnum("person_role", ["staff", "supervisor", "manager", "admin"]);

/** A person's account status. `suspended` keeps the row (and any history that references it) while
 * refusing login — the reason a status enum exists rather than a hard delete. */
export const personStatus = pgEnum("person_status", ["active", "suspended"]);

/**
 * A member of staff who can log in, ring sales, and (by role) authorize privileged actions.
 * Deliberately MUTABLE, unlike the fiscal tables: a PIN is reset, a role changes, an account is
 * suspended — so the app role holds SELECT, INSERT, UPDATE (drizzle/0001_identity_rls.sql), never a
 * DELETE and never an append-only trigger.
 */
export const persons = pgTable(
  "persons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    displayName: text("display_name").notNull(),
    /** Hashed by ./verify-pin.ts (scrypt, salted) — never plaintext. The check below refuses an
     * empty value; the hash format is the caller's responsibility. */
    pinHash: text("pin_hash").notNull(),
    role: personRole("role").notNull().default("staff"),
    status: personStatus("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The array `foreignKey({...})` form, not `.references(() => tenants.id)`: the thunk form makes
    // v8 count a never-invoked arrow as an uncovered function (drizzle-kit resolves it in a separate
    // CLI process). restrict, not cascade: deleting a tenant must not silently discard its people.
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
