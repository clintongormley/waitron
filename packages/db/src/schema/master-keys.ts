import { binary, count, id, label, table, ts } from "./columns.js";
import { persons } from "./identity/persons.js";

/**
 * One row per master key the venue has made: only what can be shown or checked without the key.
 */
export const masterKeys = table("master_keys", {
  number: count("number").primaryKey(),
  name: label("name").notNull(),
  /** Lower-case hex SHA-256 of the authority key (`masterKeyCheckValue`). */
  checkValue: label("check_value").notNull(),
  /** The sealing public key, SPKI DER. */
  publicKey: binary("public_key").notNull(),
  madeAt: ts("made_at").notNull(),
  madeBy: id("made_by").references(() => persons.id, { onDelete: "restrict" }),
});
