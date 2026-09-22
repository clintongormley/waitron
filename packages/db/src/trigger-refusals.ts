/**
 * The exact words each of this package's behavioural triggers raises when it refuses a write.
 *
 * ONE declaration, because a SQLite trigger's refusal has no other identity. `RAISE(ABORT, 'text')`
 * reports that text and nothing else — no table, no column, no constraint name — under a result
 * code it shares with every `ON DELETE RESTRICT` refusal (`./sql-state.ts`'s `TRIGGER_ABORT`). So a
 * caller translating one of these into a domain error matches the WORDS, and the words have to come
 * from somewhere both it and the migration answer to.
 *
 * The migration is `packages/db/drizzle/0001_behavioural_triggers.sql`, and it cannot import this
 * file: it is SQL, so it spells each string out. What binds the two is
 * `scripts/behavioural-triggers.test.ts`, which reads the constants below and asserts them against
 * the refusals a database the PRODUCT migrated actually raises. Reword the SQL alone and that guard
 * goes red; change a constant alone and it goes red the same way. Without it, a reworded trigger
 * would stop being translated SILENTLY — `triggerRaised` compares by equality, so the caller would
 * simply never recognise the refusal again.
 *
 * Only the seven REFUSING triggers are here. `working_orders_clear_table_status` acts instead of
 * refusing and raises nothing, so it has no wording to pin.
 */

/** `sale_settlements_check_coverage`: the tenders do not add up to the sale plus corrections plus tips. */
export const COVERAGE_REFUSAL = "tenders do not cover the sale";

/** `tenders_reject_post_settlement`: a tender arrived after the sale was settled. PostgreSQL's `WT002`. */
export const POST_SETTLEMENT_REFUSAL = "tender rejected: the sale is already settled";

/** `working_orders_enforce_transition`: the order's status may not move that way. */
export const TRANSITION_REFUSAL = "working order cannot make that transition";

/** `working_order_lines_require_open_parent_*`: the order is not open, or does not exist. */
export const OPEN_PARENT_REFUSAL = "lines may only be written while the order is open";

/** `working_order_lines_check_locales_*`: `descriptions` is not exactly the venue's invoice locales. */
export const LOCALES_REFUSAL = "descriptions must carry exactly the venue locales";

/** `working_order_lines_check_variant_locales_*`: the same, for the optional variant map. */
export const VARIANT_LOCALES_REFUSAL = "variant_descriptions must carry exactly the venue locales";

/** `device_profile_form_factor_locked`: an active device still depends on the profile's form factor. */
export const FORM_FACTOR_REFUSAL =
  "cannot change form factor of a profile in use by an active device";
