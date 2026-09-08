import { pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { locations, tenants } from "./tenants.js";

/** What an accepted request BECOMES. The two surfaces share one table because they need the same
 * columns and both models are core-set; the cross-surface decoy rule (design §1.2) is then one read
 * rather than a union two implementations must keep in step. If printing ever leaves the core for a
 * module, this enum value goes with it. */
export const joinRequestKind = pgEnum("join_request_kind", ["device", "print_agent"]);

/**
 * A pending ask-to-join: someone knocked while pairing mode was open, and an admin has not yet matched
 * its number. NEVER a `devices` or `print_agents` row — for devices that is forced (the
 * station-XOR-register constraint trigger cannot accept a request whose binding is unchosen), and for
 * agents it is chosen, so both real tables hold only approved rows and `active`/revoke keep one
 * meaning. Accept inserts the real row and deletes the request in one transaction; deny just deletes.
 *
 * `local`: a standby inherits no pending joins, which is the same fail-closed posture as the in-memory
 * pairing window (design §1.1).
 */
export const joinRequests = pgTable(
  "join_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      /* v8 ignore next */
      .references(() => tenants.id, { onDelete: "restrict" }),
    // The venue the joiner belongs to — stamped from the node's own `cfg.locationId`, exactly as
    // `generatePairingCode` stamped it, so a joiner still asks nothing about which venue it is joining.
    locationId: uuid("location_id")
      .notNull()
      /* v8 ignore next */
      .references(() => locations.id, { onDelete: "restrict" }),
    kind: joinRequestKind("kind").notNull(),
    // The name the joiner asked for. A device accept copies it to `devices.label`, an agent accept to
    // `print_agents.name`.
    label: text("label").notNull(),
    // scrypt of the token minted at join. Copied to the real row at accept, so the joiner's cookie or
    // bearer token survives approval unchanged — only its SELECTOR changes.
    tokenHash: text("token_hash").notNull(),
    // The two-digit number the joiner displays and the admin matches. NOT a secret and NOT typed: its
    // whole job is to be compared across a room, so two digits, not a Crockford string. What defends a
    // mix-up is the decoy rule plus deny-on-wrong (design §1.2), never this column's entropy.
    verificationNumber: text("verification_number").notNull(),
    // The two decoys, minted WITH the number at join and never re-rolled. Re-rolling per challenge
    // would let two calls intersect in exactly one value — the real one — so any client with a
    // management session could derive the answer and never risk a mismatch, which is the check the
    // whole design rests on (design §1.2 rule 2).
    decoyNumbers: text("decoy_numbers").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Composite (tenant_id, id) UNIQUE — the composite-FK target shape every tenant table here carries.
    unique("join_requests_tenant_id_key").on(t.tenantId, t.id),
  ],
);
